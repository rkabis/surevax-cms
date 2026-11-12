#!/usr/bin/env bash
# extract-schema-snippet.sh — print only the relevant Drizzle table blocks for
# inlining into orchestrate worker prompts. Saves ~5-10k tokens per worker that
# would otherwise grep + read the 70KB apps/backend/src/shared/db/schema.ts.
#
# Usage:
#   scripts/extract-schema-snippet.sh <table_name> [<table_name> ...]
#
# Example:
#   scripts/extract-schema-snippet.sh cash_drawer_sessions patient_allergies
#
# Output: matching table blocks, each one a `pgTable('<name>', { ... })` chunk
# with surrounding `export const` line. Stops at the closing `)` that matches
# the opening paren depth.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCHEMA="$REPO_ROOT/apps/backend/src/shared/db/schema.ts"

if [ ! -f "$SCHEMA" ]; then
  echo "extract-schema-snippet: schema.ts not found at $SCHEMA" >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <table_name> [<table_name> ...]" >&2
  exit 1
fi

for table in "$@"; do
  # Find the line that opens the table block. Two possible patterns:
  #   export const fooBar = pgTable('foo_bar', {
  #   export const fooBar = pgTable(
  #     'foo_bar',
  #     {
  start=$(grep -nE "(pgTable|pgTenantTable)\\(\\s*'$table'" "$SCHEMA" | head -1 | cut -d: -f1 || true)

  # Multi-line form: 'table_name' on its own line preceded by pgTable(
  if [ -z "${start:-}" ]; then
    start=$(grep -n "^[[:space:]]*'$table'," "$SCHEMA" | head -1 | cut -d: -f1 || true)
    if [ -n "${start:-}" ]; then
      # Walk back to the export const line that opens this block
      start=$(awk -v end="$start" 'NR<=end && /^export const / { ln=NR } END { print ln }' "$SCHEMA")
    fi
  fi

  if [ -z "${start:-}" ]; then
    echo "// extract-schema-snippet: table '$table' not found" >&2
    continue
  fi

  # Walk forward, count parens, stop when balanced + we see the closing `)` of
  # the pgTable call. Keep it simple: scan from start, track ( and ), stop at
  # the line where running count returns to 0 after first opening.
  awk -v start="$start" '
    NR < start { next }
    {
      # Strip line comments to avoid counting parens inside //
      line = $0
      sub(/\/\/.*$/, "", line)

      # Count parens on this line
      n = length(line)
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1)
        if (c == "(") depth++
        else if (c == ")") depth--
      }

      print $0
      if (depth == 0 && started) { exit }
      if (depth > 0) started = 1
    }
  ' "$SCHEMA"

  echo ""
done
