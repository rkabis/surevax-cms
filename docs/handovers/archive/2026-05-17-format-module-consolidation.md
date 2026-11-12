# Format-module consolidation — handover (deferred from 2026-05-17 audit cycle)

## Why this is its own handover

The 2026-05-17 audit closed out 18 PRs of audit-critical work. One Tier-2
item was **deliberately deferred** to a dedicated PR rather than bundled
into a sweep: consolidating two date/money formatting modules into one.

The reason: it _looks_ like a mechanical sweep, but it isn't. The two
modules export functions with **the same name and different behavior**,
so a naive rename-and-delete silently changes how dates and money render
across the app.

## Current state (as of 2026-05-17, main = `2b93f98`)

Two modules, both alive, both consumed:

| Module                        | Path                                     | Callsites |
| ----------------------------- | ---------------------------------------- | --------- |
| `format-new`                  | `apps/frontend/src/lib/format.ts`        | 8         |
| `format-legacy`               | `apps/frontend/src/shared/lib/format.ts` | 32        |
| Files importing from **both** | —                                        | 0         |

The encouraging part: **no file mixes the two modules**. Every surface
has already picked one or the other — usually `legacy` because it's
older. So the consolidation is a per-file decision, not a per-import
decision.

## Side-by-side export map

| Export                  | `@/lib/format` (new)                                                 | `@/shared/lib/format` (legacy)                       | Same behavior?                                         |
| ----------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `formatDate`            | Relative for ≤14d (`"Today"`, `"3 days ago"`); `"MMM D, YYYY"` older | Always `"MMM D, YYYY"`                               | ❌ **DIFFERENT**                                       |
| `formatDateTime`        | `"2026-05-17 08:30"` (ISO-style, no seconds)                         | Different (locale-format)                            | ❌ **DIFFERENT**                                       |
| `formatMoney`           | Accepts `string \| number`; thousand-sep                             | Accepts `string` only; thousand-sep                  | ⚠️ **SIGNATURE-DIFFERENT** (legacy throws on `number`) |
| `formatTime`            | _(missing)_                                                          | `"HH:MM"` or `"HH:MM AM/PM"`                         | n/a — legacy-only                                      |
| `formatPhpAmount`       | _(missing)_                                                          | Currency display with `PHP` prefix                   | n/a — legacy-only                                      |
| `formatScalar`          | _(missing)_                                                          | Generic `unknown → string` for detail-rail rendering | n/a — legacy-only                                      |
| `nullable(v, fallback)` | _(missing)_                                                          | Wraps `v ?? fallback`, defaults to `DASH`            | n/a — legacy-only                                      |
| `DASH`                  | \_(missing — but `formatDate` uses `'—'` literal)                    | `'—'` exported constant                              | n/a — legacy-only                                      |

## Why naive consolidation is dangerous

Suppose we go with the natural plan: "use `@/lib/format` everywhere; delete
the legacy module." Two things happen silently:

1. **Date drift.** Every legacy `formatDate(...)` callsite changes from
   absolute (`"May 12, 2026"`) to relative when ≤14 days old
   (`"5 days ago"`). For some surfaces (worklist cells, last-visit
   columns) that's an improvement. For others (audit-log timestamps,
   receipt headers, detail-rail technical metadata) it's wrong —
   absolute timestamps are the whole point of those surfaces.

2. **Money signature widening.** `formatMoney(num)` would suddenly work
   in 32 places where it currently throws on a numeric column. Looks
   like a fix, but the legacy throw was sometimes catching a real bug
   (the column comes through as a string per the `numeric` Drizzle
   serialization gotcha — `numeric → string`; if a caller is passing a
   number, the upstream cast is wrong).

The 32 legacy callsites currently produce specific visual output. Most
are "correct" in their current home — they've been QA'd live by the
audit. A blind consolidation changes ~half of them.

## The audit walkthrough informs the consolidation

The new preview walkthrough handover
([`2026-05-17-preview-walkthrough.md`](./2026-05-17-preview-walkthrough.md))
sets up a session to drive every shipped feature through the preview
MCP. **Do that walkthrough first** — it produces a list of per-surface
date/money display preferences (relative vs absolute, currency prefix
vs not, etc.) that becomes the target for consolidation.

Without that input, the consolidation is picking semantics blindly.

## Recommended consolidation plan

Once the walkthrough is done and the per-surface preferences are
documented:

### 1. Decide the collision resolution per export

For each colliding name, pick one of:

- **One supersedes:** rename the legacy callsites to use the new
  behavior intentionally; delete the legacy export. Use when the new
  shape is what every surface should converge on.
- **Both stay, renamed:** the new shape becomes `formatDateRelative`
  while legacy becomes `formatDate` (or vice-versa). Use when both
  behaviors are needed across different surfaces.

Likely outcome (informed best-guess; revisit after walkthrough):

| Export           | Resolution                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatDate`     | Keep both: `formatDate` (absolute) + `formatDateRelative` (≤14d relative). Audit log + receipts use absolute; list cells use relative.                                 |
| `formatDateTime` | Pick the ISO `"2026-05-17 08:30"` shape (already widely used in audit log); rename or delete the locale variant.                                                       |
| `formatMoney`    | Keep the wider signature (`string \| number`); legacy throws were defensive but masked the upstream cast bug. Add an upstream test to catch the cast issue separately. |

### 2. Migrate legacy-only exports

These have no equivalent in the new module — port them across:

- `formatTime` → add to `@/lib/format`
- `formatPhpAmount` → add (or fold into `formatMoney` with a `prefix: 'PHP'` option)
- `formatScalar` → add (used in detail rails for generic value rendering)
- `nullable(v, fallback)` → add (small utility, used widely)
- `DASH` → add as `export const DASH = '—'` so callers stop using the literal

### 3. Sweep callsites with intentional decisions

Walk the 32 legacy callsites and the 8 new callsites. At each, ask:

- Does this surface want **relative or absolute** dates?
- Does it render money with a **PHP** prefix or just the formatted number?
- Does it render times as `"HH:MM"` 24h or `"HH:MM AM/PM"` 12h?

Update each import + call accordingly. The mechanical part is the
import path; the human-judgment part is the per-call semantics.

### 4. Visual diff

Before merging, exercise every page that imports either module in the
preview server. Compare against screenshots captured during the audit
walkthrough. Any unintentional drift is a bug — either the
consolidation decision is wrong, or the original surface had drift the
audit didn't catch (both worth fixing).

### 5. Delete the legacy module

`apps/frontend/src/shared/lib/format.ts` → delete. The single new module
is the canonical entry point.

## Affected files (32 legacy callsites)

For pre-planning the sweep:

```bash
grep -l "@/shared/lib/format" apps/frontend/src -r | sort
```

Sample (full list at sweep-time):

- `features/branch/*` — kiosk surfaces (likely want absolute timestamps + `PHP` prefix)
- `features/scheduled-orders/*` — worklist cells (likely want relative dates)
- `features/appointments/*` — mix (booking time absolute, last-visit relative)
- `features/transactions/components/*` — receipt + history (absolute; thousand-sep money)
- `features/dashboard/*` — roster (mix; some absolute, some relative)
- `features/patients/components/*` — detail-rail metadata (absolute) + list cells (relative)
- `features/inventory/components/*` — expiry dates (absolute; FEFO depends on it)
- `features/lab-orders/components/*` — sent-at + result-received-at (mix)
- `features/scheduled-orders/components/*` — protocol day schedule (absolute)

The Pattern 29 SortableHead PR and the W2-Wave5 audit baseline both
shipped against these surfaces' current formatting; the consolidation
should leave each looking identical unless an intentional improvement
is recorded.

## Estimated effort

- **Side-by-side export map**: 30 min (this doc has a starting point)
- **Collision resolution decisions**: 1-2 hours, informed by walkthrough
- **Sweep + per-call review**: 3-4 hours (40 callsites, several seconds of judgment each)
- **Visual QA pass**: 1 hour (preview MCP across affected surfaces)
- **Delete legacy module + final typecheck/build**: 30 min

Total: **~half a day**, all of it focused work.

## Risk and rollback

- LoC change is small (~300 LoC across 40 files mostly import-line rewrites)
- Risk surface is wide (date/money displays across the whole app)
- Rollback is trivial — keep the legacy module; revert the sweep PR
- A bad consolidation merge surfaces as a screenshot-diff in the next
  audit pass; nothing breaks at runtime

## When NOT to do this

- Before the browser-verification walkthrough lands per-surface
  preferences. Without that input, you're guessing what each cell
  should look like.
- Before any other audit cycle wraps up that touches dates/money
  rendering (could compete on the same callsites).
- In the same wave as another orchestrate batch — this PR needs
  human-judgment QA, not parallel-worker dispatch.

## When TO do this

- After the preview walkthrough produces a per-surface preference list
- When date/money inconsistency is a complaint from real users
- Before adding a third date/money utility (the temptation grows once
  there are 2; cap it at 1 before that happens)

## Pointers

- New module source: `apps/frontend/src/lib/format.ts`
- Legacy module source: `apps/frontend/src/shared/lib/format.ts`
- Drizzle `numeric → string` gotcha (relevant to `formatMoney`
  signature): `.claude/rules/gotchas.md` § "`numeric` columns
  serialize as string"
- Design-system rules on date/money formatting: `.claude/rules/design-system.md` § "Formatting + status humanizer utils" — currently
  documents both modules with a note recommending the new one.
