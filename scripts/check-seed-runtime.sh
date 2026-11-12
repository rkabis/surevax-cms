#!/usr/bin/env bash
# Prevention gate — bug class: "seed ↔ runtime drift" (audit INV-2) + a live
# probe of the security boundary (AUTH-2) and the consent precondition (H7).
#
# The existing "seed smoke" only proves the seed RUNS without crashing. INV-2
# proved that's not enough: the seed completed clean while
# inventory_lot_balances (the table the UI actually reads for on-hand) was
# EMPTY — so every lot showed 0 and the first administer underflowed the
# non-negative CHECK. A seed that runs ≠ a seed that is runtime-correct.
#
# This gate asserts the RUNTIME-READ representation after a seed:
#   1. inventory_lot_balances is populated and on-hand > 0           (INV-2)
#   2. every lot with stock has a matching balance row              (INV-2 parity)
#   3. surevax_app is NOBYPASSRLS + NOSUPERUSER                     (AUTH-2 live)
#   4. every patient WITH a clinical episode has an active consent  (H7 gate)
#
# Connection: probes with DATABASE_MIGRATOR_URL when set (sees all rows
# regardless of RLS because this is a seed-correctness probe, not a tenant query),
# else falls back to DATABASE_URL. Reads apps/backend/.env if neither is in the
# environment (local `pnpm run setup` path).
#
# Run locally:  bash scripts/check-seed-runtime.sh   (after `pnpm run setup`)
# Wired into:   .github/workflows/ci.yml `test` job, after the seed step.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

ENV_FILE="apps/backend/.env"
read_env() { [[ -f "$ENV_FILE" ]] && grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

PROBE_URL="${DATABASE_MIGRATOR_URL:-}"
[[ -z "$PROBE_URL" ]] && PROBE_URL="${DATABASE_URL:-}"
[[ -z "$PROBE_URL" ]] && PROBE_URL="$(read_env DATABASE_MIGRATOR_URL)"
[[ -z "$PROBE_URL" ]] && PROBE_URL="$(read_env DATABASE_URL)"

if [[ -z "$PROBE_URL" ]]; then
  echo "check-seed-runtime: no DATABASE_URL / DATABASE_MIGRATOR_URL (env or $ENV_FILE)" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "check-seed-runtime: psql not found on PATH (install postgresql-client)" >&2
  exit 1
fi

q() { psql "$PROBE_URL" -tAX -c "$1" 2>/dev/null | tr -d '[:space:]'; }

FAIL=""
fail() { FAIL+=$'\n'"  ✗ $1"; }

# 1. inventory_lot_balances populated + on-hand > 0 ---------------------------
BAL_COUNT=$(q "SELECT count(*) FROM inventory_lot_balances")
LOT_COUNT=$(q "SELECT count(*) FROM inventory_lots WHERE quantity_on_hand > 0")
BAL_QOH=$(q "SELECT COALESCE(SUM(quantity_on_hand),0)::int FROM inventory_lot_balances")
if [[ "${LOT_COUNT:-0}" -gt 0 && "${BAL_COUNT:-0}" -eq 0 ]]; then
  fail "inventory_lot_balances is EMPTY while $LOT_COUNT lot(s) hold stock (INV-2). Seed a balance/movement per lot."
fi
if [[ "${LOT_COUNT:-0}" -gt 0 && "${BAL_QOH:-0}" -le 0 ]]; then
  fail "inventory_lot_balances total on-hand is $BAL_QOH; UI reads this column → every lot shows 0 (INV-2)."
fi

# 2. every lot with stock has a balance row (parity) --------------------------
LOTS_NO_BAL=$(q "
  SELECT count(*) FROM inventory_lots il
  WHERE il.quantity_on_hand > 0
    AND NOT EXISTS (SELECT 1 FROM inventory_lot_balances b WHERE b.lot_id = il.id)")
[[ "${LOTS_NO_BAL:-0}" -gt 0 ]] && \
  fail "$LOTS_NO_BAL lot(s) with stock have NO inventory_lot_balances row (INV-2 parity)."

# 3. surevax_app must NOT bypass RLS / be superuser (AUTH-2) -------------------
APP_ROLE=$(q "SELECT rolsuper::text||','||rolbypassrls::text FROM pg_roles WHERE rolname='surevax_app'")
if [[ -z "$APP_ROLE" ]]; then
  fail "role 'surevax_app' does not exist — the role-split migration (0001) did not run (AUTH-2)."
elif [[ "$APP_ROLE" != "false,false" ]]; then
  fail "surevax_app has rolsuper,rolbypassrls = ($APP_ROLE); both MUST be false or RLS is inert (AUTH-2)."
fi

# 4. every patient WITH a clinical episode has an active consent (H7) ---------
NO_CONSENT_CLINICAL=$(q "
  SELECT count(*) FROM patients p
  WHERE p.deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM encounters e WHERE e.patient_id = p.id)
      OR EXISTS (SELECT 1 FROM clinical_orders co WHERE co.patient_id = p.id))
    AND NOT EXISTS (
      SELECT 1 FROM consents c
      WHERE c.patient_id = p.id AND c.revoked_at IS NULL AND c.deleted_at IS NULL)")
[[ "${NO_CONSENT_CLINICAL:-0}" -gt 0 ]] && \
  fail "$NO_CONSENT_CLINICAL patient(s) with a clinical episode have NO active consent — assertActiveConsent would 403 them (H7)."

if [[ -n "$FAIL" ]]; then
  cat >&2 <<EOF
✗ Seed/runtime invariants violated (a seed that RUNS is not a seed that is correct):
$FAIL

  See the audit root cause "seed ↔ runtime drift" (INV-2) + .claude/rules/patterns.md.
EOF
  exit 1
fi

echo "check-seed-runtime: clean (balances=$BAL_COUNT on-hand=$BAL_QOH, surevax_app NOBYPASSRLS, consent gate satisfied)"
exit 0
