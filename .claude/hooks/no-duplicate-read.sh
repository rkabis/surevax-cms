#!/usr/bin/env bash
# PreToolUse hook — warn when Read targets a file already read in this session.
#
# Per the 2026-05-05 token-bloat audit: 162 redundant Reads across 44 sessions,
# worst case 9× same file. Each repeat ships the file content again at input
# rate.
#
# Strategy: track read paths in a per-session tmp file. If the same absolute
# path is Read again WITHOUT offset/limit, emit a stderr advisory.
#
# Advisory only — never blocks. The model may have a good reason (file
# changed, partial earlier read, etc.). Hook contract: exit 0 always.

set -u

[[ -z "${CLAUDE_SESSION_ID:-}" ]] && exit 0   # fail-open if no session id
command -v jq >/dev/null 2>&1 || exit 0

event="$(cat 2>/dev/null || true)"
[[ -z "$event" ]] && exit 0

tool="$(printf '%s' "$event" | jq -r '.tool_name // empty' 2>/dev/null)"
[[ "$tool" != "Read" ]] && exit 0

path="$(printf '%s' "$event" | jq -r '.tool_input.file_path // empty')"
[[ -z "$path" ]] && exit 0

# Targeted partial reads are fine — the bloat is full-file re-reads.
has_offset="$(printf '%s' "$event" | jq -r '.tool_input | has("offset") or has("limit")')"
[[ "$has_offset" == "true" ]] && exit 0

state_dir="${TMPDIR:-/tmp}/claude-read-tracker"
mkdir -p "$state_dir" 2>/dev/null || exit 0
state_file="$state_dir/${CLAUDE_SESSION_ID}.log"

# Strip leading worktree noise so /worktrees/abc/.../foo.ts and
# /worktrees/xyz/.../foo.ts collide (same logical file).
key="$(printf '%s' "$path" | sed -E 's#.*/\.claude/worktrees/[^/]+/##')"

if [[ -f "$state_file" ]] && grep -Fxq -- "$key" "$state_file" 2>/dev/null; then
  printf 'no-duplicate-read: %s\n' \
    "Already Read $(basename "$path") this session. Use Grep + offset/limit, or skip if unchanged. (.claude/rules/efficiency.md)" >&2
fi

# Always record (even on warn) so subsequent reads still trigger.
printf '%s\n' "$key" >> "$state_file" 2>/dev/null || true

exit 0
