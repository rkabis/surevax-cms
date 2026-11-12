---
name: orch-audit
description: Token-cost audit for /orchestrate sessions. Runs scripts/orch-audit.sh which streams agent JSONL transcripts (without loading them into context) + cross-references with GitHub PR LoC data, producing a tokens-per-LoC table. Use mid-session ("audit every 5-10 PRs") so compounding inefficiencies surface before they're irreversible. Trigger when the user types `/orch-audit`, says "audit the orchestrate session", "how efficient was that batch", or asks for token-vs-LoC breakdowns. Also use proactively after a wave of /orchestrate completes (or every ~6 PRs in long sessions).
trigger: /orch-audit
---

# /orch-audit

Run the token-cost audit on the current session's `/orchestrate` workers.

## When to invoke

- **Mid-session, every 5-10 PRs:** catches compounding inefficiencies (e.g.
  workers spending 10× expected on schema discovery, or doc-sweep workers
  burning context on `gh pr diff` loops) before they propagate to the next
  wave.
- **End of any /orchestrate wave:** sanity-check the spend before reporting
  back to the user.
- **When the user asks** "was that efficient?" or "how much did that batch
  cost?" — the script gives a concrete answer.

## What it does

1. Walks agent JSONL transcripts under
   `/private/tmp/claude-*/<project_key>/<session>/tasks/*.output` —
   **stream-aggregated via jq, never loaded into Claude context**.
2. For each transcript, sums `input_tokens`, `output_tokens`,
   `cache_creation_input_tokens`, `cache_read_input_tokens` (last is shown
   separately — read-from-cache is ~10× cheaper than fresh input).
3. Counts tool-use metrics per worker:
   - **Tools**: total `tool_use` blocks across all assistant turns
   - **Par%**: percentage of tool-calling turns that batched >1 tool call in a
     single response (0% = fully sequential; target >50%)
4. Extracts the `PR: <url>` line from the worker's final message.
5. Cross-references with `gh pr view --json additions,deletions` for LoC.
6. Renders a sorted `Tok/LoC` table with `Tools` and `Par%` columns, an
   aggregate footer with total tool calls + global par%, and a bottom
   **Tool Use (aggregate)** frequency table showing which tools consumed
   the most context.

The script's output is small (<2KB), so reading it costs ~500 tokens —
0.02% of the audit's coverage.

## How to run

Default — full session, sorted by Tok/LoC ascending (best first):

```bash
scripts/orch-audit.sh
```

Filter to a PR range (when working in a specific batch):

```bash
scripts/orch-audit.sh --pr-min 130 --pr-max 150
```

Show worst-N (worst Tok/LoC ratios — these are the units to learn from):

```bash
scripts/orch-audit.sh --top 10
```

Filter by date (since-style):

```bash
scripts/orch-audit.sh --since 2026-05-06
```

## Reading the output

### Tok/LoC column

- **Tok/LoC < 200**: well-amortized worker (multi-feature module unit, or
  substantial single-purpose worker)
- **Tok/LoC 200–500**: normal range for module-scoped Phase 2/3 work
- **Tok/LoC 500–1500**: expensive — investigate. Common causes: tiny PR (<50
  LoC), schema-discovery overhead, doc-sweep `gh pr diff` research path,
  silent-failure retry.
- **Tok/LoC > 1500**: anti-pattern. Worker should have been inline coordinator
  work. See `feedback_orchestrate_min_scope.md`.
- **`∞` ratio**: PR has 0 LoC (closed without merge, or worker emitted no
  diff). Token cost was wasted.

### Tools column

Total `tool_use` calls the worker made. High counts (>150) often signal:

- Redundant Reads (same file multiple times — see `feedback_token_efficiency.md`)
- Schema-discovery loops (worker grepping for columns it should have been given inline)
- Silent-failure retries (worker calling gh/curl in a loop)

### Par% column

Percentage of tool-calling turns where the worker batched >1 tool in a single
response. 0% means every tool call was its own round-trip (worst case for
token efficiency — each sequential call replays the full cache prefix).

- **0%**: all sequential — every turn had exactly 1 tool call
- **>30%**: healthy — worker is batching independent lookups
- **>60%**: excellent — worker aggressively parallelizes

The 2026-05-05 audit measured **0%** across 4,895 tool calls in 44 sessions.
A worker with consistently 0% Par% is a strong candidate for coordinator
feedback about parallelizing independent calls.

### Tool Use (aggregate) section

Cross-worker frequency table showing which tools consume the most context.
High Bash + Read counts with low Agent counts = workers not delegating broad
searches. High Edit:Bash ratio = worker making many small targeted changes
(good). High Read:Edit ratio = worker reading much more than it writes
(possible schema-discovery overhead).

## Common follow-ups

If the audit shows >2 workers with Tok/LoC > 1000:

- Apply the lessons codified in `feedback_orchestrate_*.md` — the patterns
  that caused this session's inefficiency are documented.
- Specifically check: were there tiny adjacent units that should have been
  combined? (`feedback_orchestrate_min_scope.md`)
- Was a doc-sweep worker pointed at `gh pr diff` instead of given the
  changelog inline? (`feedback_orchestrate_handover_summaries.md`)
- Were workers re-discovering schema columns? (`feedback_orchestrate_inline_schema.md`)

## Caveats

- The script reports **input + output + cache_creation** as "Tokens" —
  that's the billable cost approximation (cache_read is much cheaper).
- Coordinator-side cost (this session) is NOT in the totals — Claude Code's
  built-in `/usage` command surfaces full session totals if you need them.
- Workers that crashed early or had no `PR:` line show pr_num=`?`
  with LoC=0.

## Pair with /usage

After running this script, the user can run Claude Code's `/usage` to see
session-level totals. The two are complementary: `/orch-audit` slices by
worker (per-PR efficiency), `/usage` shows the conversation total
(coordinator + workers combined).
