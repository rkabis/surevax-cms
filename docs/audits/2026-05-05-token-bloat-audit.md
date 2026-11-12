# Token Bloat Audit — 44 Past Sessions

Date: 2026-05-05
Scope: 44 Claude Code session transcripts in `~/.claude/projects/-Users-njvil-Documents-Personal-Projects-surevax-cms-revamp*/*.jsonl` (≥200KB each)
Cross-referenced with: Anthropic docs, community guides (Apr–May 2026), this repo's existing `.claude/rules/`.

## Headline numbers

| Metric                               | Total                       | Notes                                    |
| ------------------------------------ | --------------------------- | ---------------------------------------- |
| Tool-result chars in context         | **6.15M (~1.54M tokens)**   | The single largest input-token driver    |
| Thinking chars emitted               | **470K (~118K tokens)**     | Output billed at ~5× input rate          |
| Narration text emitted               | **494K (~124K tokens)**     | "Let me check…" filler before tool calls |
| Redundant Reads                      | **162 wasted re-reads**     | Same file read 2–9× in one session       |
| Parallel tool batches                | **0 of 4,895 calls (0.0%)** | Every tool call was its own round-trip   |
| `Let me check` / `Now let me` filler | **180 instances**           | Across 1,468 narration blocks            |

## What's actually burning tokens (ranked by leverage)

### 1. Zero parallelization — 4,895/4,895 calls were sequential

Detection: count tool_results grouped in a single `user` message in the JSONL.
Result: **every assistant turn made exactly one tool call**, even when calls were obviously independent (e.g. `git status` + `git diff` + `git log`, or three independent `Read`s).

Cost: each sequential call repays the cache prefix once and adds a new turn to the chain. Three independent reads = 3 round-trips + 3 cache reads instead of 1.

**Highest-leverage fix in this audit.** See action #1.

### 2. Tool-result size is dominated by `Read` and `Bash`

```
Read   n=711   avg=4.0KB   p95=13.3KB  max=52.2KB   total=2.8MB
Bash   n=2243  avg=0.8KB   p95=2.9KB   max=28.8KB   total=1.8MB
Agent  n=116   avg=4.3KB   p95=15.0KB  max=27.9KB   total=504KB
ExitPlanMode  n=28   avg=10.9KB  max=24.4KB  total=306KB
Edit   n=730   max=108.6KB total=255KB  (max is the one-off return)
```

Read alone = 2.8MB of tool-result chars (~700K tokens). Most files are read whole when `Grep` + `Read offset/limit` would land the same answer in <2KB.

Worst session: **418KB of tool results in a single session** (~104K tokens just in results, before narration).

### 3. Thinking is on by default and disproportionately expensive

15 of 44 sessions had >10KB of thinking. Top: 73K / 64K / 48K chars.

**Verification of the claim "thinking isn't earning its cost":**

|                                   | Zero thinking (n=21) | Has thinking (n=23) | Big >10KB (n=15) |
| --------------------------------- | -------------------- | ------------------- | ---------------- |
| Avg ship signals (commits/pushes) | **7.3**              | 5.5                 | 7.0              |
| Avg user corrections              | 0.8                  | 1.1                 | **1.5**          |
| Avg error signals in tool results | 0.8                  | 1.7                 | **2.0**          |
| Avg asst msgs per session         | 193                  | 161                 | **214**          |

Zero-thinking sessions shipped 32% more work with 27% fewer corrections and ~50% fewer errors. Examples that landed clean with zero thinking: `intelligent-dhawan` (PR #76 MERGED), `priceless-cerf` (PR #77 MERGED), `gallant-euler` (14 commits, 0 corrections), `sweet-feynman` (11 commits, 0 corrections).

**Selection-bias caveat**: most zero-thinking sessions are likely Sonnet (per the `default to Sonnet` rule), and Sonnet handles the routine-work bucket. So this isn't "thinking is harmful" — it's "the routine work that fills your sessions doesn't benefit from thinking, and hard sessions stayed hard _with_ thinking". `interesting-kirch` burned 63K thinking chars and still hit 8 corrections + 4 errors in 556 msgs (1 ship signal).

**Recommendation**: cap (not disable) thinking. Output tokens are billed ~5× input.

### 4. Redundant Reads — 162 wasted reads, peaking at 9× same file

```
practical-hoover-8ae398:  31 redundant — seed.ts (9x), schema.ts (5x), 01-DATA-AND-COMPLIANCE.md (4x)
stoic-shannon-9cbed7:     26 redundant — 06-PRODUCT-WORKFLOWS.md (5x), 00-SYSTEM-CORE.md (5x)
main session:             22 redundant — DashboardPage.tsx (6x), 03-FRONTEND-UI-UX.md (3x)
interesting-kirch:        16 redundant — CLAUDE.md (6x), AppShell.tsx (3x)
```

Pattern: re-Read CLAUDE.md / context docs / large schema files repeatedly within one session. Each re-read of a 10KB file costs 10KB of input tokens that could be served from cache OR replaced by a 200-byte `Grep`.

The repo's `.claude/rules/` already has rule #4 against this. **Not enforced by tooling.**

### 5. Narration filler

180 instances of `Let me check` / `Now let me` / `Let me read` / `Let me also` across 1,468 narration blocks (12% of all narration is this filler). That's text emitted _before every tool call_, billed as output tokens at the higher rate.

### 6. Unfiltered shell output

50+ unfiltered `git log` / `pnpm install` / `find` / `railway logs` invocations across the 44 sessions. Worst: `flamboyant-dirac` with 13. The repo's `.claude/rules/efficiency.md` already documents how to trim — not enforced.

### 7. ExitPlanMode plan dumps

Average plan returned was 10.9KB, max 24.4KB. Plans get re-fed into context after exit. For trivial plans this is overhead.

## What the docs / community say (May 2026)

- **Prompt cache TTL is 5 min**: gaps >5 min between calls = cache miss, full reprocess of system + CLAUDE.md + tools. ([Lessons from building Claude Code](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything))
- **Changing the toolset mid-conversation invalidates the cached prefix** for the whole conversation. Adding/removing MCPs, hooks that change tool exposure, or `ToolSearch` deferred loads all count. ([Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))
- **CLAUDE.md is loaded every turn**: a 5KB CLAUDE.md costs 5KB on every single message in the session. Aim <200 lines. ([Claude Code costs](https://code.claude.com/docs/en/costs))
- **`MAX_THINKING_TOKENS=0` disables extended thinking entirely** via env var. `8000` is a reasonable cap for routine work. Default is 31,999. ([Building with extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking))
- **Subagents isolate context**: only the final summary returns to the parent. Use for searches, multi-file audits, anything verbose. ([Claude Code subagents](https://code.claude.com/docs/en/sub-agents))
- **Reported community wins**: 40–60% of Read tokens are typically redundant; preventing them is the single biggest improvement. ([KDnuggets — 7 ways to reduce Claude Code tokens](https://www.kdnuggets.com/7-practical-ways-to-reduce-claude-code-token-usage))
- **`/compact` and `/clear`**: compact summarizes when context gets long; clear discards entirely when switching tasks. ([MindStudio — manage Claude Code tokens](https://www.mindstudio.ai/blog/how-to-manage-claude-code-token-usage))
- **Haiku ≈ 25% of Sonnet cost** — match model to task. Default to Sonnet, escalate to Opus only when needed. ([claudefa.st — usage optimization](https://claudefa.st/blog/guide/development/usage-optimization))

## Concrete actions, ranked by leverage

### Tier 1 — biggest wins, do first

**1. Cap thinking at 8000 tokens (or 0)**. 21 sessions already shipped with zero thinking; the other 23 wasted up to 18K tokens per session on it. Expected savings: ~80K output tokens/month at current usage.

```jsonc
// ~/.claude/settings.json
{
  "env": { "MAX_THINKING_TOKENS": "8000" }, // or "0" to disable entirely
}
```

Toggle higher per-session via `/effort` when you genuinely need it.

**2. Add a "parallelize independent tool calls" rule that the model will actually obey.**
The system prompt already says this; in practice 0% of calls were batched. The fix is a positive example pinned in CLAUDE.md (or `.claude/rules/efficiency.md`):

```markdown
## Parallelize independent tool calls

When the next 2+ tool calls don't depend on each other's outputs, send them
in ONE assistant turn. Examples that MUST be parallel:

- `git status` + `git diff` + `git log` at the start of a commit flow
- Reading 3 files for a multi-file audit
- A `WebSearch` plus a `Bash grep` for a hypothesis check

Sequential is correct only when call N's input is computed from call N-1's
output. Default to parallel; ask "do I actually need the previous result?"
before issuing a new turn.
```

(Already partly in `CLAUDE.md` "Using your tools" — but examples and an audit-finding callout in `efficiency.md` will move the needle.)

**3. Ban "Let me check…" narration explicitly.**
Add to `efficiency.md`:

```markdown
## Don't narrate the next tool call

Banned filler: "Let me check…", "Now let me…", "Let me read…", "I'll start by…".
180 instances of these across 44 audited sessions = ~5K wasted output tokens.

Just call the tool. If a one-sentence status update is genuinely useful for the
user, write the result-oriented version: "Cookie domain mismatch — verifying
SameSite", not "Let me check the cookie config".
```

The model already has a "before your first tool call, state in one sentence" rule from the system prompt — the issue is the _style_ of that sentence, not its existence.

### Tier 2 — file/read hygiene

**4. Add a `pre-Read` hook that warns on duplicate reads.**
`.claude/hooks/no-duplicate-read.sh`: track Read invocations per session, emit a stderr warning when the same file is read twice. Advisory only (like the existing `context-hygiene.sh`).

**5. Trim CLAUDE.md.** Current `CLAUDE.md` is loaded every turn. Counts:

- Project `CLAUDE.md`: ~150 lines (acceptable).
- User global: ~30 lines (acceptable).
- The 5 auto-loaded `.claude/rules/*.md` files (`worktree.md`, `gotchas.md`, `risks.md`, `patterns.md`, `commits.md`, `efficiency.md`, `batch.md`, `railway.md`) — these together are _much larger_ and load on every turn.

Run `wc -l .claude/rules/*.md` and consider:

- Move infrequently-needed content to skills (load on demand).
- `gotchas.md` is the largest — split into "core gotchas" (always loaded) and "encyclopedia" (skill-loaded).

Rough target: keep the always-loaded budget (CLAUDE.md + auto-rules combined) under **800 lines / ~6KB**.

**6. Prefer `Grep` + `Read offset/limit` over full-file Reads.**
Read p95 = 13.3KB. A targeted offset/limit read is typically <500 bytes. Already in `efficiency.md` — promote to a stronger rule with an example diff.

### Tier 3 — shell + plan output

**7. Tighten the `context-hygiene` hook to _block_ (not just warn) on the worst offenders:**

- `git log` without `--oneline | head -N` or `--max-count`
- `pnpm install` without `> /dev/null` redirect
- `find /` (full-fs scans)
- `preview_network` calls without `urlPattern` or `filter`

The current hook is advisory. Promote 4 specific patterns to blocking; keep the rest advisory. Concrete: edit `.claude/hooks/context-hygiene.sh` to exit non-zero on those four.

**8. Don't use Plan Mode for trivial plans.**
ExitPlanMode results averaged 10.9KB. Plan mode shines for multi-file refactors; for one-line fixes the plan is overhead. Add to `efficiency.md`:

> Plan mode is for ≥3-file changes or design-level decisions. Skip it for
> single-file edits, doc tweaks, and any change a senior dev would do without
> writing a plan first.

### Tier 4 — model + session shape

**9. Default new sessions to Sonnet.** Already in `efficiency.md`; reinforce with a session-start hook reminder. Opus is justified for: novel architecture, multi-file refactors with tricky deps, hard debugging where wrong guesses cost hours.

**10. Use `/compact-context` aggressively.** Repo already has the skill. Add a behavioral rule: when `MEMORY.md` size + `.claude/rules/` size + tool-result chars > 80K tokens, suggest `/compact-context`.

**11. Delegate verbose searches to subagents.** Already in `efficiency.md` and `gotchas.md`. The audit shows Agent invocations are relatively rare (116 across 44 sessions) compared to direct Bash/Read (2,954 combined). Most sessions would benefit from 1-2 more Explore subagent dispatches for "where is X used" and "audit Y across module".

### Tier 5 — preserve cache

**12. Don't change the toolset mid-conversation.**
Loading new MCPs via `ToolSearch` mid-session invalidates the cached prefix. Audited sessions called `ToolSearch` 15+ times in `interesting-kirch`. If you know up-front you'll need WebSearch + WebFetch + TodoWrite, load them at session start once.

**13. Avoid >5-minute idle gaps.** Cache TTL is 5 min. When tailing CI or a deploy, use `Monitor` (event-driven) rather than `sleep 300; check`.

## Patches I'd open if you want me to

If you green-light, I can write these in this same worktree:

1. **`~/.claude/settings.json`** — add `MAX_THINKING_TOKENS: 8000`. (Out of repo scope, ask first.)
2. **`.claude/rules/efficiency.md`** — add three sections: parallelize-tool-calls, ban-narration-filler, audit-evidence callout. ~30 lines added.
3. **`.claude/hooks/context-hygiene.sh`** — promote 4 patterns to blocking. ~10 line change.
4. **`.claude/hooks/no-duplicate-read.sh`** — new advisory hook, ~30 lines.
5. **`CLAUDE.md`** — replace "Using your tools" parallel-calls paragraph with a stronger example-driven version. ~10 line change.
6. **`.claude/rules/gotchas.md`** — propose split into `gotchas-core.md` (always loaded) + a skill for the encyclopedia content. Larger restructure, ~1hr.

## Estimated savings

Conservative envelope based on the audit:

| Lever                                                | Tokens/session saved       | % of avg session |
| ---------------------------------------------------- | -------------------------- | ---------------- |
| Disable/cap thinking                                 | ~10K                       | 8–12%            |
| Parallelize tool calls (50% of currently-sequential) | ~30K (fewer cache replays) | 15–25%           |
| Stop redundant Reads                                 | ~3K                        | 2–4%             |
| Trim CLAUDE.md / always-loaded rules                 | ~2K × every turn           | compounds        |
| Filter shell output + `preview_network`              | ~5K                        | 3–5%             |
| Drop narration filler                                | ~500                       | 1%               |

**Rough projection: 30–45% reduction in tokens-per-session** if all Tier 1–2 actions land. The parallelization fix is the biggest single win and the easiest to verify (look at any new session's JSONL for grouped tool_results).

## How to verify the fix is working

After landing changes, run the audit script (`/tmp/audit-bloat.py`) on the next 5 sessions. Watch for:

- Parallel ratio > 0% (target: ≥30% of tool calls in batches)
- Mean thinking chars/session < 5K (currently 11K)
- Redundant Reads = 0 per session
- "Let me check" frequency < 2 per session (currently ~4 per session)

## Sources

- [Anthropic — Lessons from building Claude Code: Prompt caching is everything](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything)
- [Anthropic — Manage costs effectively](https://code.claude.com/docs/en/costs)
- [Anthropic — Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic — Building with extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Anthropic — Sub-agents](https://code.claude.com/docs/en/sub-agents)
- [KDnuggets — 7 practical ways to reduce Claude Code token usage](https://www.kdnuggets.com/7-practical-ways-to-reduce-claude-code-token-usage)
- [MindStudio — How to manage Claude Code token usage](https://www.mindstudio.ai/blog/how-to-manage-claude-code-token-usage)
- [claudefa.st — Pricing & usage optimization](https://claudefa.st/blog/guide/development/usage-optimization)
- [Medium — Reduce Claude Code token usage by 90%](https://medium.com/data-science-in-your-pocket/reduce-claude-code-token-usage-by-90-baa2a27b9ca3)
- [GitHub — drona23/claude-token-efficient (CLAUDE.md template)](https://github.com/drona23/claude-token-efficient)
- [buildtolaunch — Claude Code token optimization 2026 guide](https://buildtolaunch.substack.com/p/claude-code-token-optimization)
