# UX / UI / visual-density audit — 2026-07-25

Scope: the whole authenticated frontend, judged on the one device the clinic
runs (a 27" front-desk Mac at 2560×1440). Every number below was **measured in
a real browser at that resolution**, not inferred from class strings.

Backlog entries live in [`docs/STATUS.md`](../STATUS.md) — this file is the
narrative and the evidence. Anything not fixed here is filed there, so this
audit does not orphan the way
[`2026-06-12-comprehensive-review.md`](2026-06-12-comprehensive-review.md) did
(zero inbound references; several of its findings are still open in code).

> **Superseded in part — see the [2026-07-26 addendum](#addendum--2026-07-26-type-scale-retuned).**
> §1 treated the 12px body-copy floor as a constraint rather than a finding,
> and removed both of `KpiCell`'s `2xl` steps when only the padding step
> should have gone. The type scale has since been retuned for the clinic
> display. Read the addendum before acting on the type-size claims here.

## How it was measured

A temporary Playwright spec ran in the existing `visual` project (2560×1440,
Branch persona) and read geometry with `getBoundingClientRect`:

- **Chrome cost** = viewport-top → top of the first table row. One number that
  captures every band above the data, without having to decompose them.
- **Rows visible** = `(1440 − chrome) / rowHeight`.
- **Sticky** = scroll the real scroll container to the bottom, then assert the
  `<thead>` converges on the scrollport's top edge.
- **Keyboard reach** = press Tab up to 40× and record whether focus ever lands
  on a `<tbody> <tr>`.

The spec was deleted after the run; the fixes it verified are covered by the
committed E2E suite and the four visual baselines. To reproduce, re-create a
probe in `e2e/` matching `/visual\.spec\.ts/` so it inherits the 2560×1440
viewport and the auth dependency, and run it with
`PLAYWRIGHT_BASE_URL=http://localhost:<port>`.

## Headline

The design system is well built and well enforced — 35 numbered patterns, 16
layout primitives, three CI gates, and both design gates were **already clean**
at the start of this audit. Zero arbitrary text sizes, zero `TODO`/`FIXME` in
the frontend. The problems were not sloppiness; they were three things the
gates structurally cannot see:

1. **Density drifted rather than converged.** The gates check that you used the
   primitive, not what the result measures.
2. **Two documented patterns were inert at runtime.** Both had conformant
   markup everywhere and did nothing.
3. **Fixes that already existed were never wired up.** Two modules written to
   solve known findings had zero importers.

## 1. Density

### Measured, before → after

| Page                     | Chrome above row 1 | % of 1440   | Row height        | Rows visible  |
| ------------------------ | ------------------ | ----------- | ----------------- | ------------- |
| `/scheduled-orders`      | 555 → **527**      | 38.5 → 36.6 | 41 → 41           | 21 → **22**   |
| `/transactions?view=all` | 520 → **492**      | 36.1 → 34.2 | 65 → 61           | 14 → **15**   |
| `/inventory`             | 426 → **398**      | 29.6 → 27.6 | 39 → 34.5         | 26 → **29**   |
| `/lab-orders`            | — → 398.5          | 27.7        | → 34.5            | → 29          |
| `/services`              | — → 377            | 26.2        | 47 → **39**       | → 27          |
| `/admin/users`           | 386 → **366**      | 26.8 → 25.4 | 55 → 55 (content) | 18 → 18       |
| `/patients`              | 268 → **260**      | 18.6 → 18.1 | 53 → 49           | 22 → **24**   |

Two things worth staring at:

- **A quarter to over a third of the clinic's screen was spent before the first
  record.** `/scheduled-orders` — the worklist the daily loop runs on — was the
  *worst* at 555px (38.5%), because it stacks header (87px) + KPI band (137px)
  + toolbar (57px) + its own sticky sub-bar + wrapper padding.
- **The page that conforms least was the densest.** `/patients` is an
  allowlisted exception that hand-rolls a compact head and has no KPI strip, and
  it showed the most data per screen. The design system's own chrome stack was
  the cost.

### Root cause: 225 cell overrides, not the primitive

`TableCell` was already compacted vs stock shadcn (`p-2`, not `p-4`). But 225
cell className strings carried their own vertical padding — 53× `py-3`, 36×
`py-2`, 11× `py-2.5`, 14× `py-1.5` — so the same app shipped rows at 39, 41, 49,
53, 55, 57 and 65px. Nothing in the gates could see this: every one of those
cells *was* a `<TableCell>` inside a `<TableCard>` inside the canonical shape.

Fixed by moving row height into the primitive as `<Table density>` with two
tiers (Pattern 36): `compact` for worklists, `default` for reference/admin
lists. All 225 per-cell `py-*` overrides deleted; `px-*` column gutters left
alone; `colSpan` empty-state cells keep their deliberate whitespace.

Honest accounting of where the win came from: **row unification did the work,
chrome trimming was marginal.** Dropping `KpiCell`'s `2xl` step took the KPI
band from 137–155px to 117–135px (~20px, under half a row). The plan also
proposed trimming the header/toolbar/table-wrap bands from `py-4`/`py-3`; that
was **not done**, because it is 8px per band across 100+ call sites — a large
diff for a third of a row. It is filed instead.

### The 2xl ladder was buying air, not content

89% of every `2xl:` class in the tree (114 of 128) is the page-padding step.
Only 7 non-padding surfaces took a step at all — and two of them, `KpiCell`'s
`2xl:p-4` and `2xl:text-3xl`, made the KPI band *taller* on the big screen.
That is backwards for a 27" clinical display: `KpiStrip`'s `auto-fit` already
converts extra width into more columns, which is the version of "use the space"
that shows more clinic. The cell step is removed and Pattern 31 rule 3 now says
prefer more content over bigger content.

### Deferred (design decisions, filed in STATUS)

- **The KPI band costs 117–135px on every list page** — ~9% of the screen for
  four numbers. Collapsing it to a single ruled line would return ~3 rows, but
  Patterns 10 + 18 lock the anatomy, so that is the owner's call.
- **`TransactionsCreatePage` caps itself at `max-w-2xl`** — 672px inside an
  1800px shell. The cashier's main screen uses 37% of the available width.
- **`/scheduled-orders`' 527px chrome** specifically: it carries a lane-header
  layer the other worklists don't. Restructuring it is page surgery, not drift.
- **9 distinct `SheetHeader` padding variants** across detail rails. Real drift,
  but converging them risks visual regressions in rails this audit did not
  exercise, and it is not what the density finding is about.
- **`/admin/users` did not get denser** (55px, unchanged): its height is
  two-line cell CONTENT (name over email), not padding. Worth knowing before
  someone reaches for a third density tier — most "too tall" rows are content.

## 2. Two documented patterns that did nothing

### Pattern 20 sticky headers were inert app-wide

38 conformant `sticky top-0 bg-card z-10` headers, and not one of them pinned.

Cause is a CSS subtlety: **an element becomes a scrollport for *both* axes as
soon as *either* axis is non-`visible`**, and a scrollport is the containing
block for `position: sticky` descendants. `TableCard` carried
`overflow-x-auto overflow-y-hidden` (for wide-table insurance) and `Table`'s own
wrapper carried `overflow-auto`. Both are content-height, so neither can ever
scroll vertically — the header stuck to a box that never moves.

Measured before: scrolling `/transactions` by 134px moved the header up by
exactly 134px; `/inventory` 119px for 119px. 1:1, i.e. no pinning anywhere.
Measured after: `/services` scrolls 2458px and the header sits at exactly the
scrollport top (`theadTop == portTop == 320`).

Both `overflow` rules are gone; corner clipping uses border-radius on the last
row's outer cells. The tradeoff is explicit and documented: you cannot have
horizontal-scroll-on-the-card *and* sticky-against-an-outer-scroller. If a table
is genuinely wider than the shell, the page's scroller gets the horizontal
scrollbar — the card must not.

`/patients` was additionally the only main list page with no sticky header at
all. Added.

### No list row was keyboard-reachable

22 list pages attached `onClick` to a bare `<TableRow>`. `<tr>` is not
focusable, so none of those rows could be reached or activated without a mouse
— directly against the accessibility floor locked in DESIGN.md §15. Measured:
40 Tab presses on `/patients` never landed on a row.

`PatientList` made this concrete: it has a real arrow-key handler that calls
`.focus()` on `tbody tr[data-index]` elements. Those rows had no `tabIndex`, so
`.focus()` was a no-op *and*, since no row could hold focus, the `keydown`
never reached the table. Working code that could never run.

Fixed once in the primitive as `<TableRow interactive>` (focusable,
Enter/Space-activatable) and applied to all 26 clickable-row sites. It
deliberately does **not** set `role="button"` — that would strip the row out of
the table's semantics for screen readers — and does not override the global
`:focus-visible` ring. Measured after: rows reachable, `tabIndex=0`.

### `/transactions/:id/receipt` clipped 77px unreachably

`min-h-screen` inside AppShell's `overflow-hidden` container, whose height is
already `100vh − topbar − banners`. Measured: content reached 1517px in a
1440px viewport with `scrollHeight === clientHeight` — the bottom 77px was
unreachable at any scroll position, on a receipt. Now `h-full` with a
scrollable content area; `print:` variants preserved.

## 3. Fixes that existed but were never wired

- **`lib/useSafeForm.ts`** was written specifically to fix "users must submit
  before seeing per-field errors" (M7, 2026-05-23) and had **zero importers**.
  All 24 RHF forms ran the default `mode: 'onSubmit'`. Now all use it. This
  closes a STATUS item with code that was already in the repo.
- **`components/ui/empty-state.tsx`** had the `action` CTA prop that all 40 of
  the app's empty surfaces lacked, and had **never been imported**. Meanwhile
  `ListEmpty` — used 29× — had no action slot, and PATTERNS.md documented a
  split between the two that had never existed in practice. The slot moved onto
  `ListEmpty`; the unused component is deleted. One empty-state primitive.

## 4. Missing feedback

- **7 silent mutation failures.** `AllergiesCard` / `ConditionsCard` rendered
  inline errors for *edit* but had no surface at all for *add* — a failed add
  left the dialog open with nothing shown. `EmergencyContactsTab`'s delete was a
  bare `mutate(id)`. AppShell had two literal `catch { // swallow }`:
  `handleEndShift` left the shift open while staff believed they had clocked
  out, and `doLogout` discarded clock-out errors. Logout still always proceeds
  (never trap someone in a session) but now says the clock-out was not
  recorded — that is an attendance/payroll discrepancy someone must raise.
- **Blank white screen on every hard refresh.** Four route guards
  `return null` while `/api/auth/me` resolved. Now render the spinner that
  already existed for lazy-route Suspense.
- **6 full-body bare "Loading…" strings** → Skeleton, matching the 66 files
  that already did this.

## 5. Dead ends

- **Three `ComingSoonButton`s occupied the primary CTA slot on their own
  surface**, so the first thing a user reached for was a no-op: Encounters' only
  action was "New Encounter"; Inventory's rightmost (primary, per Pattern 11)
  was "Receive shipment" — stock-in is most of why that page is opened; and the
  login screen led with a full-width "Sign in with Google" above a divider that
  framed the only working path as "or continue with email". All three stubs
  remain, demoted behind a real action.
- **`/admin/patient-standing-orders`** — a working 241-line page with
  pause/resume mutations — had no nav entry and no in-app link anywhere.
  Reachable only by typing the URL. Added as "Patient Schedules".
- **Breadcrumbs printed raw display IDs** ("Patients / PAT_K9MX3VQ2"). Record
  segments now collapse to "Record".
- **`/today` had no freshness signal and nothing in the app polls**
  (`refetchInterval` appears nowhere; 30s staleTime + focus-refetch only). On a
  front-desk Mac left sitting on `/today`, focus never changes, so the lanes
  quietly stop reflecting the clinic. Added "as of HH:MM" + explicit Refresh,
  rather than introducing polling (a product decision about per-client cost).

Remaining stubs, unchanged and correctly signposted: 13 other
`ComingSoonButton` call sites, and the `/reports`, `/settings`, `/cold-chain`
page stubs. `/reports` is load-bearing for two P1 items (AR aging, V14 brand
analytics).

## 6. Doc + gate drift found while measuring

Two of these were gates that had quietly stopped gating:

- **`check-design-system.sh`'s `page-header-h1` regex only matched
  `text-lg`**, but the primitive moved to `text-xl 2xl:text-2xl` — so it had
  stopped catching new drift. Widened to `text-(lg|xl)`; it immediately found
  two real instances (`ComingSoon.tsx`, `VitalsDemoPage.tsx`), both now
  explicitly allowlisted with a reason.
- **ESLint's design rules were scoped to `src/features/**` +
  `src/shared/**`** — but `src/shared/` was consolidated away in `1cdf833`, so
  that glob matched nothing and `src/components/**` (the AppShell, ComingSoon)
  was never covered. Scope corrected; the dead
  `src/shared/components/AppShell.tsx` allowlist path fixed.
- PATTERNS.md Pattern 31's ladder table said the page title was
  `text-lg → 2xl:text-xl`; the primitive says `text-xl → 2xl:text-2xl`.
- `KpiStrip`'s `columns` prop was `@deprecated` but still passed at 15 call
  sites (and in the canonical snippet in `.claude/rules/design-system.md`).
  Prop and call sites removed.
- PATTERNS.md and `apps/frontend/CLAUDE.md` documented a `<ListEmpty>` vs
  `<EmptyState>` split that never existed in the code.

One claim from the exploration pass did **not** hold up and is recorded here so
it is not re-reported: `.claude/rules/design-system.md` was said to show a
3-step padding ladder missing `2xl:px-10`. It already had all four steps.

## Verification

- `pnpm lint`, `pnpm --filter @surevax/frontend typecheck`,
  `check-design-system.sh`, `check-tailwind-tokens.sh` — all clean.
- `pnpm --filter @surevax/frontend test` — 89 component tests pass.
- `pnpm test:e2e` — 18/18 pass, including the full daily loop (register a bite
  walk-in → administer Day-0 → collect to Paid) and day-summary close.
- `VISUAL=1 pnpm test:e2e --project=visual` — baselines regenerated (they
  encoded the old density). Only 2 of 4 shifted beyond the 2% tolerance
  (`today-cockpit`, `transactions`); the darwin-only caveat is unchanged.

---

## Addendum — 2026-07-26: type scale retuned

Two claims above were superseded the next day, after the owner pushed back
that the UI "looks small for big screens." They were right, and this audit
under-weighted it.

**What the audit got wrong.** §1 recorded that body copy sits at the 12px
floor (`text-xs`, 796 uses vs 537 for `text-sm`) and treated that as a
constraint to design density around. It should have been reported as a
finding. A 2560-wide logical desktop across a 27" panel is ~109 CSS px per
inch against the 96 px/inch the CSS pixel is defined at — so everything
rendered ~12% smaller than "standard" before accounting for front-desk
viewing distance. The dominant body size was effectively a 10.6px equivalent,
in an app whose small text is lot numbers, dose volumes and expiry dates.

**What changed.** The three dense steps of the scale moved up ~1px with their
line-heights (`text-2xs`/`xs`/`sm` → 11/13/15px), redefined as tokens in
`tailwind.config.ts` so all 1,333 call sites moved at once without touching
padding. `.eyebrow`'s hardcoded `10px` became `0.6875rem` so it participates
in the scale. `KpiCell`'s `2xl:text-3xl` was **restored** — §1 removed both
its type and padding steps; only the padding step should have gone. Padding
is air; the KPI numerals are read from across a front desk.

**Measured cost** (rows visible at 2560×1440 — pre-audit → post-audit → now):

| Page                | Pre-audit | Post-audit | After retune |
| ------------------- | --------- | ---------- | ------------ |
| `/scheduled-orders` | 21        | 22         | 21           |
| `/patients`         | 22        | 24         | 22           |
| `/transactions`     | 14        | 15         | 13           |
| `/inventory`        | 26        | 29         | 27           |
| `/admin/users`      | 18        | 18         | 17           |

Net roughly break-even against where the app started, with every piece of text
a step larger and better-led. The density work paid for the legibility.

**Rejected: fluid/`vw` type.** Viewport width is a bad proxy for apparent
size — a 13" 1440p laptop (~124 PPI) and the clinic's 27" 1440p monitor
(~109 PPI) have identical viewport width, so `vw` scaling would change
nothing about the real problem. CSS cannot read PPI or viewing distance. The
correct axis is per-device, and with one target device that means getting the
base scale right, not scaling it dynamically. If the app later ships to mixed
hardware, the mechanism is a persisted `data-density` preference on `<html>`.
