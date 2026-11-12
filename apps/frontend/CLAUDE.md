# CLAUDE.md — SureVax CMS Frontend

Read this before generating UI in `apps/frontend/`. The repo-root
`CLAUDE.md` declares the stack and bans (Tailwind + shadcn/ui, no Vue,
no axios, etc.); this file covers _how UI gets shaped_ on top of that.

## Clinic context (read first)

EMR for a single Philippine rabies/vaccination clinic. UI decisions follow how
the clinic actually works (full preferences + form-surface plan:
[`docs/handovers/archive/2026-05-31-ui-form-surface-redesign.md`](../../docs/handovers/archive/2026-05-31-ui-form-surface-redesign.md)):

- **One device: the 27" front-desk Mac (2560×1440).** Build + screenshot there
  first. Kiosk / tablet / mobile / touch / offline are **deferred** — don't
  invest in small-screen work now (the shared primitives are already responsive
  as cheap insurance).
- **One operator: the `Branch` role does everything** (register, administer,
  take payment, reconcile); **the Today cockpit (`/today`, PATTERNS.md
  Pattern 33) is home** — Dashboard remains for stats/shift widgets. Don't build per-role landing
  pages or role-gated UI yet.
- **Daily loop:** Scheduled Orders "due today" worklist → **Administer** (fast
  overlay) → **payment after** (sequential). Walk-in first visits use the
  **Arrivals wizard** (a page). **End-of-day:** the Dashboard surfaces **Cash
  today** + **Non-cash today** and the shift menu wires **Print EOD report** →
  the print-ready `/day-summary` (auto-prints) and **Close drawer** → the
  existing `DrawerCloseDialog`. The generated end-of-day report **is**
  `/day-summary` (A4 print stylesheet) — not the `/reports` stub.
- **Worklists answer "what needs me now"** (urgency-sorted, due-today first),
  **dense tables**, keyboard + mouse, **typed-reason gate** on irreversible
  actions (payments hard-gated; administration flexible).
- **Form surfaces:** overlay vs page by complexity — see PATTERNS.md "Form
  surface — overlay vs page". The **patient record + register/edit are full
  pages** reached via search, not a 672px sheet.
- **Standing-order schedule, not "PEP"-specific** — patients may be on rabies
  PEP or another scheduled-dose vaccine; show generic standing-order status.

## How UI gets built — the three rules

### 1. Always reach for a shadcn primitive first

Before writing a `<div className="…">`, ask: is there a shadcn
component for this? Almost always, yes.

| You want…            | Use                                              |
| -------------------- | ------------------------------------------------ |
| Button               | `<Button variant=...>`                           |
| Container w/ heading | `<Card>` + `CardHeader` / `CardContent`          |
| Status pill          | `<Badge variant=...>`                            |
| Tabular data         | `<Table>` + `TableRow` / `TableCell`             |
| Right-side drawer    | `<Sheet side="right">`                           |
| Modal                | `<Dialog>`                                       |
| Confirm action       | `<AlertDialog>`                                  |
| Form input           | `<Input>` / `<Select>` / `<Textarea>` + `<Form>` |
| Tooltip / hover help | `<Tooltip>`                                      |

If a primitive is missing, install it (`npx shadcn@latest add <name>`)
rather than hand-rolling an equivalent. Existing primitives live under
[`apps/frontend/src/components/ui/`](src/components/ui).

### 2. Never invent a color

Colors come from CSS variables in
[`apps/frontend/src/index.css`](src/index.css). The palette is
SureVax's own — clinical-teal `--primary`, faintly tinted
`--background`, dark ink-teal `--sidebar-*` (see PATTERNS.md "Theme
identity tokens" for values + change protocol). Use Tailwind's
token classes:

- `bg-background`, `bg-card`, `bg-primary`, `bg-secondary`, `bg-muted`,
  `bg-destructive`
- `text-foreground`, `text-muted-foreground`,
  `text-primary-foreground`, `text-destructive`
- `border-border`, `ring-ring`
- Inside the AppShell nav rail ONLY: `bg-sidebar`, `bg-sidebar-accent`,
  `text-sidebar-foreground`, `text-sidebar-primary`,
  `border-sidebar-border`, `ring-sidebar-ring` — never on content
  surfaces (PATTERNS.md Pattern 19)

**Clinical extensions** (also in `index.css`, exposed in
`tailwind.config.ts` as `colors.triage.*`):

- `text-triage-overdue`, `bg-triage-overdue-soft`,
  `border-triage-overdue/35`
- Same with `due`, `ok`, `info`.

These are status-only — they do not carry brand identity. Reach for
them when severity is the meaning, not when you want a neutral or
brand-colored surface.

If you need a new conceptual color, add it to `index.css` as a token
and expose it in `tailwind.config.ts`. Don't use raw hex / oklch in
component classes.

### 3. Extend, don't fork

If `Button` needs a new look (e.g. an `accent` variant), edit the cva
block in
[`apps/frontend/src/components/ui/button.tsx`](src/components/ui/button.tsx)
— don't make a `BrandButton.tsx`. This keeps `npx shadcn add` working
and the upgrade path open.

The same rule applies to `Badge`: the clinical
`overdue / due / ok / info` variants live in the existing cva block in
[`apps/frontend/src/components/ui/badge.tsx`](src/components/ui/badge.tsx).
Add new variants there, not in a new component.

## Text sizes — tokens only

Never use Tailwind's arbitrary-value syntax for text sizes (`text-[Npx]`,
`text-[Nrem]`). The scale is:

| Token       | Size  | When                                                                                                      |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `text-2xs`  | 11 px | Sub-xs labels — kbd hints, badge micro-text, mono micro-eyebrows. Don't use for human-readable body copy. |
| `text-xs`   | 13 px | Floor for readable body copy, table cells, helper text                                                    |
| `text-sm`   | 15 px | Default body, form labels, list rows                                                                      |
| `text-base` | 16 px | Paragraph text                                                                                            |
| `text-lg`   | 18 px | Sub-heads; legacy page titles (PatientList override)                                                      |
| `text-xl`   | 20 px | Page-head title (Pattern 11; steps to `text-2xl` at `2xl` via PageHeader); card section heads             |
| `text-2xl`  | 24 px | KPI value (PATTERNS.md Pattern 18; steps to `text-3xl` at `2xl` via KpiCell)                              |

If no token fits, add a new entry to `theme.extend.fontSize` in
[`tailwind.config.ts`](tailwind.config.ts) and document the use case —
don't reach for `text-[Npx]` inline. The
[`scripts/check-tailwind-tokens.sh`](../../scripts/check-tailwind-tokens.sh)
CI step rejects the arbitrary-value syntax.

Tailwind spacing utilities (sidebar `w-56`, kbd `h-5`) and CSS variables
remain allowed — they're rem-based, so they scale with the root step below.

**Arbitrary pixel values must be rem, not px** (changed 2026-07-26). Write
`grid-cols-[7.5rem_1fr_8.75rem]`, not `grid-cols-[120px_1fr_140px]`. The app
steps its root font size on the clinic display, and anything hard-coded in px
stays frozen while everything around it grows — 88 such values were converted
when the step landed. The one exception is hairlines (≤ 2px): a 1px divider
should be 1px at any scale.

Detail-rail width belongs to
[`<DetailSheet>`](src/components/layout/DetailSheet.tsx), not inline classes.

## Sizing for the room, not the mockup

The interface is scaled up on the clinic display: `html { font-size: 112.5% }`
above `1536px` (`index.css`), which makes **everything** rem-based bigger —
text, button and input heights, padding, gaps, icons, radius. It's one number
in one place; retune it there rather than bumping component sizes.

Why it exists: a 2560-wide logical desktop across a 27" panel is ~109 CSS px
per inch against the 96 the CSS pixel is defined at, so the whole UI rendered
~12% smaller than "standard" before accounting for a front desk sitting
further from the screen than a laptop.

**A global scale cannot fix a _relative_ size mistake** — scaling everything
preserves whichever element is wrongly smallest. So size by consequence, not
by category:

- The thing a nurse must **verify** is never smaller than the thing that
  merely **identifies** it. Batch number and expiry outrank the brand name in
  the administer picker, because those are what get checked against the vial.
- **Stop signals outrank labels.** "RECALLED" / "Under recall" render a step
  larger than neighbouring badges. Do not let a safety flag inherit
  `text-2xs` from the badge next to it.
- **`text-2xs` is for kbd hints and micro-eyebrows only.** Never for a dose
  number, lot code, expiry, or anything read before an injection.
- **Don't shrink the primary action.** No `h-7` overrides on a row's main
  clinical button; `size="sm"` is already the floor.

## Numbers, IDs, money

Use Tailwind's `font-mono tabular-nums` on:

- IDs (`PAT_K9MX3VQ2`, `TXN_M3WPK7VR`, `MRN-000042`, lot `SR-118`)
- Times (`09:42`, `14:00`)
- Dates in shorthand (`28 Apr`)
- Money (`₱4,820.00`)
- Doses (`0.1 mL ID`, `2,080 IU`)
- Counts in dense tables

`tabular-nums` keeps numerals aligned vertically across rows — important
in clinical lists where users scan columns of money or compliance
percentages. `font-mono` resolves to **JetBrains Mono Variable** and
`font-sans` to **Inter Variable** — both self-hosted via
`@fontsource-variable` imports in `main.tsx` (see PATTERNS.md
"Typography identity"). Never hand-roll `font-family` in a component.

## Patterns specific to clinical workflow

These conventions make the app read as a clinical tool, not generic
SaaS. Read [`docs/PATTERNS.md`](docs/PATTERNS.md) for the full list.
Highlights:

- **Severity stripe** — every actionable list row gets
  `data-severity={overdue|due|ok|info}` and the `stripe` class. Renders
  a 3 px left border. Do NOT color the row background instead — stripe
  is the convention.
- **Triage badge** — status uses
  `<Badge variant="overdue|due|ok|info">`. Never use color words ("red",
  "green") in copy — use the action ("Overdue", "Completed").
- **Action rail** — when a list row is selected, detail opens in
  [`<DetailSheet>`](src/components/layout/DetailSheet.tsx) hosted by
  [`<DetailRail>`](src/components/layout/DetailRail.tsx) (Pattern 6) —
  non-modal at `2xl` so the list stays interactive beside it. Three
  width presets: `narrow` (worklist detail), `standard` (default, most
  pages), `wide` (form-heavy / commit flow). Multi-stage commits run as
  inline flow panels inside the rail (Pattern 35), never stacked
  dialogs. Do NOT use a modal for record detail, and do NOT hand-roll
  `<SheetContent side="right">` markup.
- **Atomic commit blocks** — multi-write actions (Day-0 intake,
  transaction commit) show a "what happens on commit" summary panel
  before the button, listing effects with severity dots.
- **Worklist over CRUD** — landing pages should answer "what needs me
  now?" not "show me everything." Sort by severity, group by lane
  (`Overdue → Due → Upcoming`), filter via `<Tabs>` segmented control.
- **Sticky table headers** — every list page applies
  `sticky top-0 bg-card z-10` to its `<TableHeader>` (or `<thead>`,
  or grid header div). Column labels never scroll out of view.
  See Pattern 20.
- **Page head** — use [`<PageHeader>`](src/components/layout/PageHeader.tsx)
  (Pattern 11). Owns title typography, subtitle, and right-aligned
  action group. Button order non-negotiable: secondary outline buttons
  left, primary CTA rightmost. All `size="sm"` with `h-3.5 w-3.5 mr-1.5`
  leading icons. Page outer wrap stays
  `<div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">`.
- **KPI strip** — use [`<KpiStrip>`](src/components/layout/KpiStrip.tsx) +
  [`<KpiCell>`](src/components/layout/KpiCell.tsx) (Patterns 10 + 18).
  Don't hand-roll `<Card><div className="grid divide-x">…` markup.
- **List page shell** — every list/table route uses
  [`<PageToolbar>`](src/components/layout/PageToolbar.tsx) for the
  filter/search row and [`<TableCard>`](src/components/layout/TableCard.tsx)
  to wrap the table (Pattern 25). Tables are never edge-to-edge — they
  sit inside a rounded card with `px-4 sm:px-6 xl:px-8 2xl:px-10 py-4` outer
  padding. Don't hand-roll `<div className="border rounded-md
overflow-hidden">` wrappers. Page content is globally capped at
  `max-w-screen-2xl` (1800px `max-w-shell` at `2xl`) by the AppShell
  `<Outlet>` wrapper — the wide-screen scaling ladder is PATTERNS.md
  Pattern 31; primitives own the `2xl` steps, pages don't.
- **Empty state** — use [`<ListEmpty>`](src/components/layout/ListEmpty.tsx)
  (Pattern 21). Render above/instead-of the table when data is empty —
  not inside a `<TableRow>`. It is the app's ONLY empty-state primitive;
  the dashed-border `<EmptyState>` that used to live in `components/ui/`
  was deleted in the 2026-07-25 audit (never imported once) and its CTA
  slot moved onto `ListEmpty` as `action`. Pass an `action` when there is
  a real next step; omit it for a search/filter miss, where the next step
  is changing the query.
- **Table density** — set `<Table density="compact">` on worklists,
  leave `default` on reference/admin lists, and never put `py-*` on a
  `TableCell`/`TableHead`. See PATTERNS.md Pattern 36. Clickable rows
  take `<TableRow interactive>` so they are keyboard-reachable.
- **Sticky save footer** — any one-page form/wizard whose content can
  scroll splits into header / scroll-body / sticky `<footer>` so Save
  never disappears. Same rule applies inside `<Sheet>` edit modes
  (`<SheetContent className="flex flex-col">` + footer sibling). See
  Pattern 22.
- **Disabled stub CTA** — when a button is intentionally not wired up
  yet, use `<Tooltip>` over `<span tabIndex={0}>` over the disabled
  `<Button>` so users see "Coming soon" on hover instead of a silent
  no-op. The wrapping `<span>` is required because disabled buttons
  don't fire hover events. See Pattern 23.

## Component map (reference)

[`docs/COMPONENT-MAP.md`](docs/COMPONENT-MAP.md) lists every clinical
concept and its shadcn primitive. When generating a feature, consult it
first.

## Things to NEVER do

- Inline hex / oklch colors in components — use tokens
- Custom button components — extend `Button` variants in `button.tsx`
- Modals for things that should be a Sheet (anything you want
  side-by-side with the list)
- Skip the severity stripe on actionable list rows
- Decorative gradients or drop shadows beyond shadcn defaults
- Emojis (except in chat/notes content from users)
- Color words in user-facing copy ("the red ones") — use the meaning
  ("the overdue ones")

## Intentional override: BranchKiosk (Staff Clock In/Out screen)

[`features/branch/components/BranchKiosk.tsx`](src/features/branch/components/BranchKiosk.tsx)
is the staff clock-in / clock-out kiosk. It is reachable by all logged-in
roles via the "Staff Kiosk" link in the Today nav group and via the
"Staff kiosk" button on the Dashboard. It deliberately steps outside
the shadcn token system: dark `bg-zinc-950` canvas, `rounded-2xl` cards,
larger touch-target sizing suited for a shared lobby display. When
changing visuals, treat it as a self-contained surface — do NOT
"normalize" it to the rest of the design system, and do NOT propagate
its zinc/dark palette into staff-facing features.

## When you're not sure

1. Check [`docs/PATTERNS.md`](docs/PATTERNS.md) first
2. Then [`docs/COMPONENT-MAP.md`](docs/COMPONENT-MAP.md)
3. Then the existing screen most similar to what you're building
   ([`features/scheduled-orders/ScheduledOrdersPage.tsx`](src/features/scheduled-orders/ScheduledOrdersPage.tsx)
   is the canonical worklist;
   [`features/arrivals/ArrivalsPage.tsx`](src/features/arrivals/ArrivalsPage.tsx)
   is the canonical wizard;
   [`features/transactions/TransactionsCreatePage.tsx`](src/features/transactions/TransactionsCreatePage.tsx)
   is the canonical cashier flow)
4. Only then ask the user
