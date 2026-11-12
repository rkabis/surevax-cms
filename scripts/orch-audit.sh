#!/usr/bin/env bash
# orch-audit.sh — token-cost audit for /orchestrate sessions.
#
# Walks the agent JSONL transcripts in /private/tmp/claude-501/.../tasks/*.output,
# extracts per-agent token totals and tool-use stats (without loading the transcripts
# into Claude context), then cross-references with GitHub PRs (LoC) to produce:
#   1. A token-per-LoC table with tool call count + parallelism rate per worker
#   2. An aggregate tool-frequency table (which tools cost the most context)
#
# Designed to be run mid-session ("audit every 5-10 PRs") so compounding
# inefficiencies surface before they're irreversible.
#
# Output is small (a markdown table) — safe for Claude to Read.
#
# Usage:
#   scripts/orch-audit.sh                       # audit all PRs in current repo
#   scripts/orch-audit.sh --since 2026-05-06    # filter PRs created on/after date
#   scripts/orch-audit.sh --pr-min 100          # filter to PRs >= #100
#   scripts/orch-audit.sh --top 20              # show top 20 worst tok/LoC ratios
#
# Requires: jq, gh, bash 4+
set -eo pipefail   # nullglob arrays empty under set -u; rely on explicit checks

PR_MIN=0
PR_MAX=99999
SINCE=""
TOP_N=0
WORST_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --since)    SINCE="$2"; shift 2 ;;
    --pr-min)   PR_MIN="$2"; shift 2 ;;
    --pr-max)   PR_MAX="$2"; shift 2 ;;
    --top)      TOP_N="$2"; shift 2 ;;
    --worst)    WORST_ONLY=1; shift ;;
    -h|--help)  sed -n '2,/^set -e/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_ROOT"

# Find the right transcript root for THIS project (encoded path = / -> -)
PROJECT_KEY=$(printf '%s' "$REPO_ROOT" | sed 's|[/._]|-|g')
shopt -s nullglob 2>/dev/null || true
# Collect unique transcript dirs (claude-* glob can include claude-501; dedupe).
_DIRS=( /private/tmp/claude-*/${PROJECT_KEY}/*/tasks )
TRANSCRIPT_DIRS=()
seen=$'\n'
for d in "${_DIRS[@]}"; do
  case "$seen" in *$'\n'"$d"$'\n'*) ;; *) TRANSCRIPT_DIRS+=("$d"); seen="$seen$d"$'\n' ;; esac
done

# ----------------------------------------------------------------------------
# Step 1: aggregate per-agent tokens + tool stats by streaming JSONL via jq.
# Output rows (tab-separated, 11 columns):
#   aid | input | output | cache_creation | cache_read | total |
#   tool_calls | par_turns | tool_turns | tools_str | pr_url
#
#   tool_calls  = total tool_use blocks across all assistant turns
#   par_turns   = assistant turns with >1 tool_use block (parallel batches)
#   tool_turns  = assistant turns with >=1 tool_use block
#   tools_str   = "ToolA:N,ToolB:M,..." sorted descending by count
# ----------------------------------------------------------------------------
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
AGENTS_TSV="$TMPDIR/agents.tsv"
: > "$AGENTS_TSV"

for dir in "${TRANSCRIPT_DIRS[@]}"; do
  for f in "$dir"/*.output; do
    [ -f "$f" ] || continue
    agent_id=$(basename "$f" .output)

    set +e
    jq -nrR --arg AID "$agent_id" '
      [inputs]
      | (map(. as $line | try (fromjson | .message.usage // null) catch null) | map(select(.))) as $usage
      | (map(. as $line
              | try (fromjson | .message.content) catch null
              | select(type == "array"))
         | flatten
         | map(select(type == "object" and .type == "text"))
         | last
         | (.text // "")) as $final_text
      | (map(. as $line
              | try (fromjson | .message.content) catch null
              | select(type == "array")
              | map(select(type == "object" and .type == "tool_use") | .name))
         | flatten
         | group_by(.)
         | map({name: .[0], count: length})
         | sort_by(-.count)) as $tools
      | (map(. as $line
              | try (fromjson | .message.content) catch null
              | select(type == "array")
              | (map(select(type == "object" and .type == "tool_use")) | length))
         | map(select(. > 0))) as $tcounts
      | {
          agent_id: $AID,
          input: ($usage | map(.input_tokens // 0) | add // 0),
          output: ($usage | map(.output_tokens // 0) | add // 0),
          cache_creation: ($usage | map(.cache_creation_input_tokens // 0) | add // 0),
          cache_read: ($usage | map(.cache_read_input_tokens // 0) | add // 0),
          tool_calls: ($tools | map(.count) | add // 0),
          par_turns: ($tcounts | map(select(. > 1)) | length),
          tool_turns: ($tcounts | length),
          tools: ($tools | map("\(.name):\(.count)") | join(",")),
          pr_url: (try ($final_text | gsub("\\*+"; "") | capture("PR[^:\\n]*:\\s*(?<url>https://github\\.com/[^\\s)]+/pull/[0-9]+)") | .url) catch "")
        }
      | "\(.agent_id)\t\(.input)\t\(.output)\t\(.cache_creation)\t\(.cache_read)\t\(.input + .output + .cache_creation)\t\(.tool_calls)\t\(.par_turns)\t\(.tool_turns)\t\(.tools)\t\(.pr_url)"
    ' < "$f" >> "$AGENTS_TSV" 2>>"$TMPDIR/jq.err"
    rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      printf '%s\t-\t-\t-\t-\t-\t-\t-\t-\t\tparse-error\n' "$agent_id" >> "$AGENTS_TSV"
    fi
  done
done

if [ ! -s "$AGENTS_TSV" ]; then
  echo "orch-audit: no agent transcripts found under /private/tmp/claude-*/${PROJECT_KEY}*/tasks/" >&2
  echo "(this is normal if no agents have run in this session yet)" >&2
  exit 0
fi

# ----------------------------------------------------------------------------
# Step 2: pull PR metadata via gh
# ----------------------------------------------------------------------------
PRS_TSV="$TMPDIR/prs.tsv"
GH_ARGS=(--state all --limit 200 --json number,title,additions,deletions,state,url)
if [ -n "$SINCE" ]; then GH_ARGS+=(--search "created:>=$SINCE"); fi

gh pr list "${GH_ARGS[@]}" \
  --jq '.[] | [.number, .additions, .deletions, .state, .url, .title] | @tsv' \
  > "$PRS_TSV" 2>/dev/null || true

# ----------------------------------------------------------------------------
# Step 3: join — for each agent row with a PR URL, look up the PR's LoC.
# JOINED columns (tab-separated, 9 columns):
#   ratio | #pr_num | loc_str | total | ratio_human | tc | par_pct | pr_state | title
# ----------------------------------------------------------------------------
PR_LOOKUP="$TMPDIR/pr-lookup.tsv"
awk -F'\t' '{ printf "%s\t%s/%s\t%s\t%s\t%s\t%s\n", $1, $2, $3, ($2 + $3), $4, $5, $6 }' "$PRS_TSV" > "$PR_LOOKUP"
# Columns: pr_num | "+a/-d" | total_loc | state | url | title
pr_lookup() {
  awk -F'\t' -v num="$1" '$1 == num { print; exit }' "$PR_LOOKUP"
}

JOINED="$TMPDIR/joined.tsv"
: > "$JOINED"

while IFS=$'\t' read -r aid in_t out_t cc cr total tc par tt tools_str pr_url; do
  [ "$in_t" = "-" ] && continue
  [ "$total" -lt 1000 ] && continue   # skip noise

  # par_pct: percentage of tool-calling turns that were parallel (>1 tool/turn)
  tc_num=${tc:-0}
  tt_num=${tt:-0}
  par_num=${par:-0}
  if [ "$tc_num" = "0" ] || [ "$tt_num" = "0" ] 2>/dev/null; then
    par_pct="-"
  else
    par_pct="$(( par_num * 100 / tt_num ))%"
  fi

  pr_num=$(echo "$pr_url" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' || true)
  if [ -z "${pr_num:-}" ]; then
    pr_num="?"
    loc_str="-"
    loc_total=0
    title="(no PR)"
    pr_state="-"
  else
    [ "$pr_num" -lt "$PR_MIN" ] && continue
    [ "$pr_num" -gt "$PR_MAX" ] && continue
    pr_row=$(pr_lookup "$pr_num")
    if [ -n "$pr_row" ]; then
      loc_str=$(echo "$pr_row" | cut -f2)
      loc_total=$(echo "$pr_row" | cut -f3)
      pr_state=$(echo "$pr_row" | cut -f4)
      title=$(echo "$pr_row" | cut -f6)
    else
      loc_str="?/?"
      loc_total=0
      title="(unknown)"
      pr_state="?"
    fi
  fi

  if [ "$loc_total" -gt 0 ]; then
    ratio=$(( total * 100 / loc_total ))     # tok/LoC × 100 for awk-free sort
    ratio_human=$(( total / loc_total ))
  else
    ratio=999999
    ratio_human="∞"
  fi

  printf '%s\t#%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$ratio" "$pr_num" "$loc_str" "$total" "$ratio_human" \
    "${tc_num}" "${par_pct}" "$pr_state" \
    "$(printf '%s' "$title" | cut -c1-50)" \
    >> "$JOINED"
done < "$AGENTS_TSV"

# ----------------------------------------------------------------------------
# Step 4: render the main table
# Columns: Tok/L | PR | LoC (+/-) | Tokens | Tok/LoC | Tools | Par% | State | Title
# ----------------------------------------------------------------------------
{
  printf '%-6s | %-9s | %-12s | %-10s | %-9s | %-6s | %-6s | %-9s | %s\n' \
    "Tok/L" "PR" "LoC (+/-)" "Tokens" "Tok/LoC" "Tools" "Par%" "State" "Title"
  printf '%-6s-+-%-9s-+-%-12s-+-%-10s-+-%-9s-+-%-6s-+-%-6s-+-%-9s-+-%s\n' \
    "------" "---------" "------------" "----------" "---------" "------" "------" "---------" "-----"
  if [ "$TOP_N" -gt 0 ]; then
    sort -rn "$JOINED" | head -n "$TOP_N" | \
      awk -F'\t' '{printf "%-6s | %-9s | %-12s | %-10s | %-9s | %-6s | %-6s | %-9s | %s\n", $1, $2, $3, $4, $5, $6, $7, $8, $9}'
  else
    sort -n "$JOINED" | \
      awk -F'\t' '{printf "%-6s | %-9s | %-12s | %-10s | %-9s | %-6s | %-6s | %-9s | %s\n", $1, $2, $3, $4, $5, $6, $7, $8, $9}'
  fi
} | column -t -s '|' 2>/dev/null || cat

# Aggregate footer
echo ""
awk -F'\t' '
  {
    split($3, lparts, "/")
    total_tok += $4
    total_loc += lparts[1] + lparts[2]
    total_tc  += ($6+0)
    split($7, pp, "%"); total_par_num += pp[1]+0; if (pp[1] != "-" && $7 != "-") par_count++
    n++
  }
  END {
    global_par = (par_count > 0 ? sprintf("%d%%", total_par_num / par_count) : "n/a")
    printf "Workers: %d | Sum tokens: %s | Mean tok/LoC: %s | Total tool calls: %d | Global par%%: %s\n",
      n,
      (total_tok > 1000000 ? sprintf("%.1fM", total_tok/1000000) : sprintf("%dk", total_tok/1000)),
      (total_loc > 0 ? sprintf("%d", total_tok/total_loc) : "n/a"),
      total_tc,
      global_par
  }
' "$JOINED"

# ----------------------------------------------------------------------------
# Step 5: tool-frequency breakdown across all workers
# Parses the tools_str field (col 10) of AGENTS_TSV: "ToolA:N,ToolB:M,..."
# ----------------------------------------------------------------------------
TOOLS_AGG="$TMPDIR/tools_agg.tsv"
awk -F'\t' '
$2 != "-" && $10 != "" {
  n = split($10, tools, ",")
  for (i = 1; i <= n; i++) {
    split(tools[i], kv, ":")
    if (kv[1] != "") freq[kv[1]] += (kv[2]+0)
    total_calls += (kv[2]+0)
  }
}
END {
  for (t in freq) printf "%d\t%s\n", freq[t], t
  printf "TOTAL\t%d\n", total_calls > "/dev/stderr"
}
' "$AGENTS_TSV" 2>"$TMPDIR/tools_total.txt" | sort -rn > "$TOOLS_AGG"

TOOLS_TOTAL=$(cat "$TMPDIR/tools_total.txt" 2>/dev/null | awk '{print $2}')

if [ -s "$TOOLS_AGG" ]; then
  echo ""
  printf "Tool Use (aggregate, total=%s)\n" "${TOOLS_TOTAL:-0}"
  printf "%-32s | %s\n" "Tool" "Calls"
  printf -- "%.32s-+-%.5s\n" "--------------------------------" "-----"
  awk -F'\t' '{printf "%-32s | %d\n", $2, $1}' "$TOOLS_AGG"
fi

echo ""
echo "Tip: run /usage in Claude Code for session-level (input + output + cache) token totals."
