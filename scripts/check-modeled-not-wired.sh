#!/usr/bin/env bash
# Prevention gate: bug class "modeled but not wired" (audit CLIN-1, RECALL-1,
# NOTIF-2, APPR-1).
#
# A behaviour-implying schema column (a flag that is SUPPOSED to change runtime
# behaviour) shipped with ZERO enforcing code. Tests passed because the
# enforcement was never asserted: you cannot fail a test for behaviour nobody
# wrote. Examples: requires_dose_calculation (no dose calculator existed),
# patient_notification_required (no recall fan-out), required_approvers (quorum
# ignored), consent_verified_at (never written/checked).
#
# ── Two mechanisms, on purpose ───────────────────────────────────────────────
#
# Mechanism 1, FLAGS: textual presence of the flag identifier outside
# schema.ts/tests/seed. This is enough ONLY when every place that reads the
# flag is itself reachable from the app (a mounted route, a directly-invoked
# helper). It is NOT enough when the reader is dead code: a flag read inside
# a function nobody calls still shows up as a textual "consumer", which is
# exactly how the recall bug slipped through. `fanOutRecallNotifications`
# reads `patientNotificationRequired` in its own body, so the old FLAGS-only
# version of this script saw a match and passed, even though the function
# itself has zero callers anywhere (not from createRecall/updateRecall, no
# route, no worker, no test, a real recall notifies nobody).
#
# Mechanism 2, ENFORCEMENT_FUNCTIONS: reachability, not text. For a flag whose
# enforcement lives behind a distinctly named function, list the function
# instead of the flag. The check requires at least one reference to the BARE
# function-name identifier outside: the function's own definition line,
# comment-only lines (so a JSDoc header naming the function, or a seed
# comment saying "consumed by X", doesn't count as a caller), and
# schema.ts/tests/seed. Matching the bare identifier, not `name(`, means a
# function that is reachable only through an indirect reference still counts
# as wired:
#   - HTTP route: router.post(path, handlerName)        (name, no parens)
#   - Registry:   const MAP = { EventType.Foo: handlerName }
#   - Barrel:     export { handlerName } from './db.js'
# All three leave the identifier on a line that is neither the definition nor
# a comment, so they pass. Only a name that appears NOWHERE but its own
# declaration and its own comments is flagged, which is what actually
# happened to `fanOutRecallNotifications`: every other place it appears is
# the docblock above its own definition, or a seed comment.
#
# Flags stay on Mechanism 1 when their enforcement is inline in code that is
# already known-reachable (no standalone function to name): requiredApprovers
# (quorum math inline in admin/approvals.ts, itself a mounted route body) and
# consentVerifiedAt (consent check inline in notificationConsumer, itself
# directly invoked from domainEventsPublisher.ts). requiresDoseCalculation
# moved to Mechanism 2 (resolveDoseRule) since its enforcement DOES live
# behind a standalone, separately-callable function.
#
# MAINTENANCE: when you add a column whose presence implies runtime behaviour
# (a `requires_*`, `*_required`, quorum count, verification timestamp, an
# enable/gate flag), add it to FLAGS if its enforcement is inline in
# already-reachable code, or to ENFORCEMENT_FUNCTIONS (by function name) if
# its enforcement lives behind a standalone function that could itself go
# dead. The column add and its enforcing code should land in the SAME PR.
#
# Invoked from `pnpm agent:check` (scripts/check-agent-ready.sh).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# camelCase identifiers as they appear in schema.ts column declarations + code.
FLAGS=(
  requiredApprovers           # approval_requests: quorum inline in admin/approvals.ts (mounted route)
  consentVerifiedAt           # notifications: consent gate inline in notificationConsumer.ts (directly invoked)
)

# Function names whose reachability (not text) is the actual signal.
ENFORCEMENT_FUNCTIONS=(
  fanOutRecallNotifications   # product_recalls: must drive patient_notification_required fan-out
  resolveDoseRule             # shared/utils/doseCalc.ts, called from modules/dose_calc/routes.ts: must drive requires_dose_calculation
)

# Search roots for consumers (exclude the schema definition, tests, and seed).
SEARCH_DIRS=(apps/backend/src apps/frontend/src)
EXCLUDE_RE='schema\.ts|/tests/|/seed/|\.test\.|\.spec\.'

OFFENDERS=""

for flag in "${FLAGS[@]}"; do
  consumers=$(grep -rn "$flag" "${SEARCH_DIRS[@]}" \
                --include="*.ts" --include="*.tsx" 2>/dev/null \
              | grep -vE "$EXCLUDE_RE" || true)
  if [[ -z "$consumers" ]]; then
    OFFENDERS+=$'\n'"  $flag: schema flag has no consumer (modeled but not wired)"
  fi
done

for fn in "${ENFORCEMENT_FUNCTIONS[@]}"; do
  refs=$(grep -rnE "\b${fn}\b" "${SEARCH_DIRS[@]}" \
           --include="*.ts" --include="*.tsx" 2>/dev/null \
         | grep -vE "$EXCLUDE_RE" \
         | grep -vE "(export[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+${fn}\(" \
         | grep -vE "(export[[:space:]]+)?const[[:space:]]+${fn}[[:space:]]*=" \
         | grep -vE ':[[:space:]]*(//|\*)' \
         || true)
  if [[ -z "$refs" ]]; then
    OFFENDERS+=$'\n'"  $fn: enforcement function has zero callers anywhere (modeled but not wired)"
  fi
done

if [[ -n "$OFFENDERS" ]]; then
  cat >&2 <<EOF
Behaviour-implying schema flag(s) or enforcement function(s) not wired:
$OFFENDERS

  A flag that is supposed to change runtime behaviour must have at least one
  consumer outside schema.ts/tests/seed, AND if that consumer is a standalone
  function, the function itself must have a caller somewhere in application
  code (a route, a worker, another function), not just a mention inside its
  own docblock or a seed comment. Ship the column add and its enforcing code
  (+ a test that asserts the behaviour) in the SAME PR.
  See .claude/rules/gotchas.md / the audit "modeled-but-not-wired" root cause.
EOF
  exit 1
fi

exit 0
