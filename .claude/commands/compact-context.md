---
description: Summarize the current conversation into a structured handover note and start a fresh session pre-loaded with just that note.
argument-hint: "[optional focus, e.g. 'just the failing migration']"
---

# /compact-context

The current conversation has accumulated tool outputs, file reads, and back-and-forth that no longer earn their token cost. Compact it into a structured handover note and hand off to a fresh session that loads only the note.

## What to do

1. **Pick the handover path.** Default: `docs/handovers/$(date +%Y-%m-%d)-compact-$(date +%H%M).md`. If a worktree-specific path makes more sense (e.g. inside an active feature spec dir), use that. Tell the user the path you chose.

2. **Write the handover note** as a single markdown file using the template below. Pull from your own conversation memory — do **not** re-read every file you previously touched. The point is compression. Focus argument: $ARGUMENTS

3. **Validate the note is self-sufficient.** A fresh agent reading only this note plus `CLAUDE.md` and the referenced files must be able to continue the work. If the note depends on something you only saw inline (a long error trace, a paste-only spec), capture the load-bearing 3–5 lines verbatim and reference the source for the rest.

4. **Verify nothing important is lost.** Skim the conversation for: pending TODOs, unreverted edits, decisions made, dead-ends already ruled out, environment state (running servers, branches, uncommitted files). All belong in the note.

5. **Print the handoff command.** End your message with the exact command the user runs to start the fresh session, e.g.:

   ```
   claude --resume-with "$(cat docs/handovers/2026-05-05-compact-1430.md)"
   ```

   (Or, if the harness has a `/resume-from <path>` style command, use that. Adapt to whatever the user's workflow expects — don't invent a flag that doesn't exist.)

6. **Do not start a new session yourself.** You can't fork; that's the user's action. Your job ends at producing the note + handoff command.

## Handover note template

```markdown
# Handover — <one-line title>

**Started**: <when>
**Compacted**: <date>
**Worktree / branch**: <path / branch>

## Goal

<1–3 sentences. What is the user trying to accomplish in this session?>

## State of play

- **Done**: <bullet list of what's already landed in this session — files edited, commits made, tests passing>
- **In progress**: <what was mid-flight when /compact-context fired>
- **Blocked / open questions**: <anything the user needs to decide>

## Decisions made (don't relitigate)

- <decision> — <one-line rationale>
- <decision> — <one-line rationale>

## Dead ends (don't retry)

- <approach tried> — <why it didn't work>

## Files touched / load-bearing references

- `path/to/file.ts:42` — <why it matters>
- `docs/specs/...md` — <link, not transcribed>

## Environment state

- Dev server: <running at http://localhost:NNNN | not running>
- Uncommitted changes: <y/n — list staged + unstaged files>
- Active branch: <branch name>
- Recent commits this session: <SHAs + subjects>

## Next step

<One specific, actionable instruction the next agent should execute first.>
```

## Rules

- **Compression target**: the note should be < 4 KB. If you can't summarize under that, the conversation is doing too much — split into multiple handovers per topic.
- **No verbatim transcription** of files the next agent can re-read. Reference by path.
- **No re-pasting tool outputs** unless they're load-bearing and ephemeral (a one-shot error message, a build hash). For anything reproducible, give the command to re-run.
- If the user passed an argument like `just the failing migration`, scope the note to that thread; mention other threads briefly under "Out of scope".
- This command is for _long_ sessions. If the conversation is short (< 20 turns) push back: it's cheaper to keep going than to compact.
