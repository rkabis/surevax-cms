# Handovers

Dated, append-only session notes: **what changed, what's next, gotchas found.**

## Rules

- **One file per handover, named `YYYY-MM-DD-<slug>.md`.** Append new files; do
  not rewrite past entries.
- **Thin.** A handover records the narrative of a work session. It does NOT
  restate or redefine the backlog. Link to [`../STATUS.md`](../STATUS.md) for
  that.
- **No "canonical" or "active" handover.** There is no active handover. The
  living state is [`../STATUS.md`](../STATUS.md); handovers are history.
- **Archive on supersession.** When a note's content is folded into `STATUS.md`
  or a later note, move it to [`archive/`](archive/).

## Current unarchived records

| Record                                                                                                   | Scope                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`2026-08-23-phase-1-revenue-integrity-reporting.md`](2026-08-23-phase-1-revenue-integrity-reporting.md) | PR #618 reporting investigation, implementation and decision record; open work links back to `STATUS.md` |
| [`2026-06-19-appsheet-data-crosscheck.md`](2026-06-19-appsheet-data-crosscheck.md)                       | AppSheet live-data cross-check and capability-gap evidence                                               |

## Why

The backlog used to live inside a dated "state of the art" handover that kept
getting superseded and re-homed, so "what's next" drifted across `TODO.md`, the
handover, and the risk register. Keeping durable state in `STATUS.md` (edited in
place) and narrative here (append-only) stops that drift.

## Latest indexed handovers

| Date       | Record                                                                                                                                                                       | Live state                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2026-08-23 | [`2026-08-23-phase-1-financial-controls.md`](2026-08-23-phase-1-financial-controls.md) — implementation, adversarial review, verification, and decision boundary for PR #617 | [`../STATUS.md`](../STATUS.md) Phase-1 financial controls closeout |
