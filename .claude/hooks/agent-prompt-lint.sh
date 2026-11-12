#!/usr/bin/env bash
# PreToolUse hook: lint Agent dispatch prompts for silent-stall signals.
#
# Blocks Agent tool calls whose prompt is missing the phrases that prevent
# workers from finishing work without pushing or opening a PR.
#
# Required phrases (any one of each group must be present):
#   Group A (push):       "git push"
#   Group B (PR open):    "gh pr create"
#
# If either group is absent, the dispatch is blocked with a checklist.
# This makes feedback_batch_worker_silent_push_failure.md mechanically
# enforceable instead of relying on memory.
#
# Hook contract: reads JSON event on stdin, exits 0 to allow, 2 to block.

set -u

block() { printf 'agent-prompt-lint BLOCK: %s\n' "$1" >&2; exit 2; }

event="$(cat 2>/dev/null || true)"
[[ -z "$event" ]] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool="$(printf '%s' "$event" | jq -r '.tool_name // empty' 2>/dev/null)"
[[ "$tool" != "Agent" ]] && exit 0

# Read-only research dispatches (Explore, or an explicit code-reviewer) never
# commit, push, or open a PR. Enforcing ship language on them blocks legitimate
# research delegation. Only implementation-capable subagent types are held to
# the push and PR checklist, while all agents retain relevant advisories.
read_only_agent=0
subagent_type="$(printf '%s' "$event" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)"
case "$subagent_type" in
  Explore|code-reviewer)
    read_only_agent=1
    ;;
esac

prompt="$(printf '%s' "$event" | jq -r '.tool_input.prompt // empty' 2>/dev/null)"
[[ -z "$prompt" ]] && exit 0

missing=()
advisory=()

# BLOCKING checks (silent-stall prevention)

if [ "$read_only_agent" -eq 0 ]; then
  if ! printf '%s' "$prompt" | grep -q 'git push'; then
    missing+=("  [ ] No 'git push': worker must push its branch before reporting done")
  fi

  if ! printf '%s' "$prompt" | grep -q 'gh pr create'; then
    missing+=("  [ ] No 'gh pr create': worker must open a PR before reporting done")
  fi
fi

if [ "${#missing[@]}" -gt 0 ]; then
  printf 'agent-prompt-lint BLOCK: worker prompt is missing required phrases.\n' >&2
  printf 'Add the missing instructions to the prompt, then retry:\n' >&2
  for m in "${missing[@]}"; do printf '%s\n' "$m" >&2; done
  printf '\nSee: .claude/memory/feedback_batch_worker_silent_push_failure.md\n' >&2
  exit 2
fi

# ADVISORY checks (warn but allow)

# expected-loc annotation (#4, LoC budget guardrail)
if [ "$read_only_agent" -eq 0 ] && ! printf '%s' "$prompt" | grep -qE '<!--\s*expected-loc:\s*[0-9]+'; then
  advisory+=("  advisory: no '<!-- expected-loc: N -->' annotation. Add one so post-dispatch LoC check can warn on runaway workers. See fix #4.")
fi

# parallelization guidance (#6)
if ! printf '%s' "$prompt" | grep -qiE 'parallel|batch independent|independent tool calls'; then
  advisory+=("  advisory: no parallelization guidance found. Workers default to sequential tool calls (0% par% measured across 21 workers). Add section 10 from WORKER_TEMPLATE.md. See fix #6.")
fi

if [ "${#advisory[@]}" -gt 0 ]; then
  printf 'agent-prompt-lint ADVISORY (prompt dispatching anyway):\n' >&2
  for a in "${advisory[@]}"; do printf '%s\n' "$a" >&2; done
fi

exit 0
