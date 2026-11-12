# Token Efficiency

Solo project. Token cost matters. These rules exist so routine work
doesn't burn budget that belongs to hard problems.

> **Audit (2026-05-05, 44 sessions):** zero parallelization across
> 4,895 tool calls; 1.5M tokens in tool results; 162 redundant Reads;
> 180× "Let me check…" filler. Full report: [`docs/audits/2026-05-05-token-bloat-audit.md`](../../docs/audits/2026-05-05-token-bloat-audit.md).
> The rules below target each finding directly.

## Default posture

- **Be terse.** Short updates, one sentence between tool calls, no
  recap-paragraphs at end of turns. The user reads diffs and
  commit messages — don't restate them.
- **Don't paste back what the user pasted.** If they gave you a stack
  trace or request dump, refer to it, don't quote it.
- **Don't write plans for trivial work.** Plan mode is for multi-file
  designs, not one-line fixes. ExitPlanMode results averaged 11 KB
  in audited sessions — skip plan mode for single-file edits.

## Parallelize independent tool calls

Audit found **0 parallel batches across 4,895 tool calls**. This is the
single biggest token leak. Every sequential call replays the cache prefix
(CLAUDE.md + rules + tools) once.

When the next 2+ tool calls don't depend on each other's outputs, send
them in **one assistant turn** — multiple tool_use blocks in the same
response. Mandatory parallel cases:

- `git status` + `git diff` + `git log` at the start of a commit flow
- Reading 3 files for an audit / cross-reference
- A `WebSearch` plus a `Bash grep` for a hypothesis check
- Multiple `Read`s on different files to assemble context
- `gh pr view` + `gh pr checks` for the same PR

Sequential is correct only when call N's input is computed from call
N-1's output. Default to parallel; ask "do I actually need the previous
result?" before issuing a new turn.

## Don't narrate the next tool call

Audit found 180 instances of `Let me check`, `Now let me`, `Let me read`,
`Let me also` across 1,468 narration blocks. That's text emitted at the
output rate (~5× input cost) before every tool call.

Banned filler phrases: `Let me check`, `Let me also`, `Let me read`,
`Let me first`, `Now let me`, `I'll start by`, `I'll check`.

If a one-sentence status update genuinely helps the user, write the
result-oriented version: `Cookie domain mismatch — verifying SameSite`,
not `Let me check the cookie config`. Better still: just call the tool.

## Reads: grep first, read second

Audit found 162 redundant Reads (same file 2–9× per session). Worst
offender: `seed.ts` read 9× in one session.

- Use `Grep` to find lines, then `Read` with `offset`/`limit` to pull
  just those lines. P95 Read result was 13 KB — most reads can be <500 B.
- Full-file `Read` is only justified when the file is small (<100
  lines) or you genuinely need the whole structure.
- **Don't re-Read a file in the same session.** Cache the path
  mentally. Use offset/limit on second visits, or grep for the line.

## Shell output: trim at the source

Never let a long command dump its full output into context. Pipe or
flag it to the slice you actually need.

```bash
# Bad — hundreds of lines of poll output
gh pr checks --watch --fail-fast

# Good — watch, but only keep the final summary
gh pr checks --watch --fail-fast 2>&1 | tail -5

# Bad — whole diff
git diff

# Good
git diff --stat
git diff path/to/one-file.ts
```

Same rule for: `railway logs` (always `| tail -N`), `npm/pnpm install`
(redirect), `gh run view` (use `--log-failed` or `--json`), `curl`
(`-s` + `grep`/`head` to the relevant bit). The `context-hygiene.sh`
hook will **block** unfiltered `git log`, `pnpm install`, full-fs
`find /`, and unfiltered `preview_network` — fix the command, don't
fight the hook.

Prefer `--json ... --jq '...'` on `gh` commands over parsing text.

## Troubleshooting: hypothesis first, then one targeted check

When a deploy/test/request fails:

1. State the hypothesis in one sentence ("the bundle has no
   VITE_API_URL so fetch falls back to relative").
2. Write **one** command that would prove or disprove it (curl the
   deployed JS for the Railway URL; grep the source for hardcoded
   `/api`).
3. Only then act.

Don't loop: retry → check browser → retry → check browser. That
pattern burns tokens and rarely isolates the cause. If two retries
haven't fixed it, the hypothesis is wrong — change the hypothesis,
not the retry count.

## Subagents: only when scope is broad

- Single known file / clear keyword → direct `Grep` or `Read`.
- "Trace how auth works across the codebase" → Explore subagent.
- Don't use subagents for work a single `Grep` would answer.

Audit shows Agent invocations are _underused_ (116 across 44 sessions
vs 2,954 direct Bash/Read). Sessions doing multi-file audits would save
context by delegating — the subagent's tool noise stays in its own
context, only the summary returns.

## Commit/PR flow

- `/ship` uses `gh pr create --fill` — no bespoke PR bodies. The
  commit message is the PR body. Don't override without an explicit
  ask.
- Auto-merge is enabled repo-wide; `/ship` queues it and exits. Don't
  sit on `gh pr checks --watch` unless the user asks for verification.

## Model + thinking choice

Three tiers, allocated by judgment-per-token, not by task size:

- **Sonnet** — execution tier. Routine edits, `/ship`, doc updates, CLI
  ops, and ALL orchestration workers (impl agents in `/orchestrate` and
  `/orchestrate-pilot` are pinned to Sonnet).
- **Opus** — judgment tier. Adversarial verify agents, hard debugging
  where a wrong guess costs hours, multi-file refactors with tricky
  deps. ~5× Sonnet output cost.
- **Fable** — planning/decision tier (2× Opus output, $50/MTok).
  Reserve for: wave design + unit decomposition, cascading-cause
  debugging (RLS/trigger/money clusters), security-sensitive design
  (tenant isolation, break-glass, DPA), and 1M-context cross-cutting
  refactors. Rule: **Fable plans/diagnoses/decides; Sonnet executes.**
  Fable writing large diffs inline is waste — delegate via
  `Agent(model: "sonnet", isolation: "worktree")` or
  `/orchestrate-pilot`. Exception: diffs <100 LoC stay inline — the
  delegation overhead (prompting, report-reading, verification) is
  itself paid in coordinator tokens and exceeds the edit.
- Fast mode (`/fast`) does **not** save cost — it's Opus with
  faster output, same price.
- **Thinking is capped at 8000 tokens** (`MAX_THINKING_TOKENS=8000` in
  user settings.json). Audit found 21/44 sessions shipped successfully
  with zero thinking; the 15 sessions with >10 KB thinking still hit
  more corrections + errors than zero-thinking ones. Hard problems
  stay hard with or without thinking; routine work doesn't need it.
  Use `/effort high` ad-hoc when you genuinely need deep reasoning.

## Preserve prompt cache

- Cache TTL is 5 min. Don't sleep > 270s when the next call would hit
  the same prefix — use `Monitor` for event-driven waits instead of
  `sleep` polling.
- Don't change the toolset mid-conversation: loading new MCPs via
  `ToolSearch` invalidates the cached prefix for the whole session.
  If you'll need WebSearch + WebFetch + TodoWrite, load them once at
  the start.

## Always-loaded budget

Project `CLAUDE.md` + `.claude/rules/*.md` are loaded every turn. Target:
keep the always-loaded budget under **800 lines combined**. Move
single-module / encyclopedia content into skills (load on demand).
Current decomposition:

- `gotchas.md` (core) → high-frequency gotchas only
- `gotchas` skill → low-frequency / single-module deep details

## What not to do

- Don't re-Read files you already read this session unless you
  changed them. (The `no-duplicate-read.sh` hook warns you.)
- Don't run `git status` after every edit — batch the check before
  the commit.
- Don't narrate (see "Don't narrate the next tool call" above).
- Don't paste large specs verbatim — reference by path, summarize in
  3–5 lines.
