#!/usr/bin/env bash
# PreToolUse hook — context-bloat defense.
#
# Two tiers:
#   BLOCK (exit 2):  worst-offender patterns that always dump unbounded
#                    context. Fix the command and retry.
#   ADVISE (stderr): borderline cases where the model can decide.
#
# Hook contract: reads JSON event on stdin, exits 0 to allow, 2 to block.

set -u

SIZE_THRESHOLD_KB=20
BASH_OUTPUT_BUDGET_KB=16

advise() { printf 'context-hygiene: %s\n' "$1" >&2; }
block()  { printf 'context-hygiene BLOCK: %s\n' "$1" >&2; exit 2; }

event="$(cat 2>/dev/null || true)"
[[ -z "$event" ]] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool="$(printf '%s' "$event" | jq -r '.tool_name // empty' 2>/dev/null)"
[[ -z "$tool" ]] && exit 0

case "$tool" in
  Read)
    path="$(printf '%s' "$event" | jq -r '.tool_input.file_path // empty')"
    [[ -z "$path" || ! -f "$path" ]] && exit 0
    has_limit="$(printf '%s' "$event" | jq -r '.tool_input | has("limit") or has("offset")')"
    [[ "$has_limit" == "true" ]] && exit 0
    bytes="$(stat -f%z "$path" 2>/dev/null || stat -c%s "$path" 2>/dev/null || echo 0)"
    kb=$(( bytes / 1024 ))
    if (( kb >= SIZE_THRESHOLD_KB )); then
      advise "Read targets ${kb} KB ($(basename "$path")). Use Grep + Read offset/limit, or delegate to Explore subagent."
    fi
    ;;

  Bash)
    cmd="$(printf '%s' "$event" | jq -r '.tool_input.command // empty')"
    [[ -z "$cmd" ]] && exit 0

    # Already self-trimmed → allow.
    if printf '%s' "$cmd" | grep -Eq '\|\s*(head|tail|wc|grep|awk|sed|jq|cut|sort|uniq)\b|--jq\b|--log-failed\b|--json\b|>\s*/dev/null|2>\s*/dev/null|2>&1\s*\|'; then
      exit 0
    fi

    # ----- BLOCKING patterns (the four worst offenders from the audit) -----
    # 1. find / or find from filesystem root (full-fs scans)
    if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])find[[:space:]]+/[^[:space:]]*'; then
      block "find scanning from / will exhaust resources. Search from . or a specific path."
    fi
    # 2. pnpm/npm/yarn install without redirect
    if printf '%s' "$cmd" | grep -Eq '^(pnpm|npm|yarn)\s+(install|i)\b'; then
      block "pnpm/npm/yarn install dumps progress + warnings. Append: > /dev/null 2>&1 (or | tail -20)."
    fi
    # 3. git log without --oneline | head | tail | -n N | --max-count
    if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])git\s+log\b' \
       && ! printf '%s' "$cmd" | grep -Eq '(--oneline|--max-count|-n\s*[0-9]|-[0-9])'; then
      block "git log without --oneline / -n N / --max-count dumps the full history. Constrain it."
    fi
    # 4. railway logs without tail / head / grep — known to flood
    if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])railway\s+logs\b'; then
      block "railway logs streams unbounded. Pipe to | tail -50 or | grep PATTERN."
    fi

    # ----- Advisory patterns (model judgement) -----
    if printf '%s' "$cmd" | grep -Eq '^(git diff|gh pr (checks|view|diff)|gh run view|cat\s)'; then
      advise "Bash command may dump > ${BASH_OUTPUT_BUDGET_KB} KB. Pipe through head/tail/grep or use --json --jq."
    elif printf '%s' "$cmd" | grep -Eq '^\s*(curl|wget)\b' && ! printf '%s' "$cmd" | grep -Eq '\-s|\-\-silent'; then
      advise "Add -s + grep/jq to curl so you only land the bytes you need in context."
    fi
    ;;

  mcp__Claude_Preview__preview_network)
    has_filter="$(printf '%s' "$event" | jq -r '.tool_input | has("urlPattern") or has("filter")')"
    if [[ "$has_filter" != "true" ]]; then
      block "preview_network without urlPattern/filter dumps every static-asset 200. Add urlPattern:\"/api/\" or filter:\"failed\"."
    fi
    ;;

  mcp__Claude_Preview__preview_logs|mcp__Claude_Preview__preview_console_logs)
    has_filter="$(printf '%s' "$event" | jq -r '.tool_input | has("filter") or has("pattern") or has("limit")')"
    if [[ "$has_filter" != "true" ]]; then
      advise "${tool##*__} without a filter/pattern/limit can return hundreds of lines. Constrain it."
    fi
    ;;
esac

exit 0
