#!/usr/bin/env bash
# PostToolUse hook — fires after every Agent completion.
#
# Two jobs:
#   A. LoC budget check (#4): if the worker prompt had an <!-- expected-loc: N -->
#      annotation, look up the PR's actual LoC and warn if it exceeds 5× budget.
#   B. Orch-audit reminder (#5): after every 5th Agent completion in a session,
#      print a reminder to run scripts/orch-audit.sh.
#
# Both are advisory (exit 0) — never block.
#
# Hook contract: reads JSON event on stdin, exits 0 always.

set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
PROJECT_KEY=$(printf '%s' "$REPO_ROOT" | tr '/' '-' | tr '.' '-')

warn() { printf 'post-agent-audit: %s\n' "$1" >&2; }

event="$(cat 2>/dev/null || true)"
[[ -z "$event" ]] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool="$(printf '%s' "$event" | jq -r '.tool_name // empty' 2>/dev/null)"
[[ "$tool" != "Agent" ]] && exit 0

# ── B: orch-audit reminder ───────────────────────────────────────────────────
COUNTER_FILE="/tmp/orch-agent-count-${PROJECT_KEY}"
count=1
if [ -f "$COUNTER_FILE" ]; then
  count=$(( $(cat "$COUNTER_FILE") + 1 ))
fi
printf '%d' "$count" > "$COUNTER_FILE"

if (( count % 5 == 0 )); then
  warn "────────────────────────────────────────────────────────────"
  warn "${count} Agent completions in this session."
  warn "Consider running: scripts/orch-audit.sh --top 5"
  warn "  → surfaces compounding Tok/LoC inefficiencies mid-session"
  warn "────────────────────────────────────────────────────────────"
fi

# ── A: LoC budget check ──────────────────────────────────────────────────────
command -v gh >/dev/null 2>&1 || exit 0

prompt="$(printf '%s' "$event" | jq -r '.tool_input.prompt // empty' 2>/dev/null)"
[[ -z "$prompt" ]] && exit 0

expected_loc=$(printf '%s' "$prompt" | grep -oE '<!--\s*expected-loc:\s*[0-9]+' | grep -oE '[0-9]+' | head -1)
[[ -z "$expected_loc" ]] && exit 0

# Scan full event JSON for a GitHub PR URL (format-agnostic, like Option A).
result_raw=$(printf '%s' "$event" | jq -r 'tostring' 2>/dev/null)
pr_url=$(printf '%s' "$result_raw" | grep -oE 'https://github\.com/[^"\\s)]+/pull/[0-9]+' | head -1)
[[ -z "$pr_url" ]] && exit 0

pr_num=$(printf '%s' "$pr_url" | grep -oE '[0-9]+$')
[[ -z "$pr_num" ]] && exit 0

actual_loc=$(gh pr view "$pr_num" --json additions,deletions \
  --jq '.additions + .deletions' 2>/dev/null || echo "")
[[ -z "$actual_loc" || "$actual_loc" == "null" ]] && exit 0

threshold=$(( expected_loc * 5 ))
if (( actual_loc > threshold )); then
  warn "────────────────────────────────────────────────────────────"
  warn "LoC OVERRUN on PR #${pr_num}: expected ~${expected_loc} LoC, actual ${actual_loc} LoC ($(( actual_loc * 100 / expected_loc ))% of budget)"
  warn "At this size the unit likely should have been done inline."
  warn "See: .claude/memory/feedback_orchestrate_small_diff_inline.md"
  warn "────────────────────────────────────────────────────────────"
fi

exit 0
