#!/usr/bin/env bash
# scripts/check-tailwind-tokens.sh — block arbitrary text-size values
#
# Tailwind's `text-[<value>]` arbitrary-syntax bypasses the theme scale,
# which is how the audit (2026-05-16) found 50+ drifted instances of
# `text-[10px]` / `text-[11px]` / `text-[13px]` / `text-[22px]` across
# the codebase. This script blocks new ones at PR time. The canonical
# sizes are:
#
#   text-2xs   10px   (sub-xs labels, kbd hints, badge micro-text)
#   text-xs    12px   (floor for human-readable body copy)
#   text-sm    14px
#   text-base  16px
#   text-lg    18px   (page-head titles)
#   text-xl    20px
#   text-2xl   24px
#
# If you need a size that isn't on the scale, add a token to
# tailwind.config.ts under theme.extend.fontSize — don't reach for the
# arbitrary-value syntax in a component.
#
# Other Tailwind arbitrary-value forms (pixel widths like w-[420px] for
# the Sheet rail, grid templates like grid-cols-[120px_1fr_140px]) are
# intentionally allowed — they don't have a token equivalent.
#
# Exit codes: 0 = clean, 1 = violations found.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${ROOT}/apps/frontend/src"

if [ ! -d "$TARGET" ]; then
  echo "check-tailwind-tokens: ${TARGET} not found — nothing to check" >&2
  exit 0
fi

# Match `text-[<digits>(.<digits>)?px]` inside any string. Pixel-rem
# tokens are scale tokens, so block both `text-[Npx]` and `text-[Nrem]`
# but skip `text-[<word>]` (CSS variable / named tokens like
# `text-[--primary]` which we don't use today but might in the future).
PATTERN='text-\[[0-9]+(\.[0-9]+)?(px|rem)\]'

# Some files predate this rule. Until the codemod sweeps them, allow a
# narrow per-file allowlist by name. Each line is a path relative to
# repo root, no comments. Empty = no exemptions.
ALLOWLIST_FILE="${ROOT}/scripts/check-tailwind-tokens.allowlist"
ALLOW_GREP_ARGS=""
if [ -f "$ALLOWLIST_FILE" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    ALLOW_GREP_ARGS="${ALLOW_GREP_ARGS} --exclude=$(basename "$line")"
  done < "$ALLOWLIST_FILE"
fi

# shellcheck disable=SC2086  # ALLOW_GREP_ARGS is intentionally word-split
violations=$(grep -rEn "$PATTERN" "$TARGET" --include='*.tsx' --include='*.ts' $ALLOW_GREP_ARGS 2>/dev/null || true)

if [ -z "$violations" ]; then
  echo "check-tailwind-tokens: clean (0 arbitrary text sizes in ${TARGET#$ROOT/})"
  exit 0
fi

count=$(printf '%s\n' "$violations" | wc -l | tr -d ' ')
echo "check-tailwind-tokens: ${count} arbitrary text-size violation(s):" >&2
echo "$violations" >&2
cat >&2 <<'EOF'

Fix: replace `text-[Npx]` with the matching token from
apps/frontend/tailwind.config.ts (text-2xs / text-xs / text-sm / text-base
/ text-lg / text-xl / text-2xl). If no token fits, add one in
tailwind.config.ts under theme.extend.fontSize and document the use case
— don't bypass the scale.
EOF
exit 1
