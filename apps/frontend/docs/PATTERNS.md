# PATTERNS.md — SureVax UI patterns

The design conventions that turn vanilla shadcn into a clinical
product. Each pattern: name → when to use → minimal code → variants.

---

## Page archetypes — pick one before you build

There is **no single page template**. Every page composes the shared
primitives in `@/components/layout`, but the _shape_ depends on the page's
job. Pick the matching archetype first, then follow its patterns — don't
invent a new layout. Pages stay consistent _within_ an archetype; a
dashboard is supposed to look different from a list.

| Archetype           | Use for                                         | Composition                                                                                                                                  | Canonical example                                                      |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Cockpit**         | The home surface — today's loop as live lanes   | `PageHeader` → `KpiStrip` → lane grid (`2xl:grid-cols-4`) of severity-striped cards, each with ONE deep-link action. No tables, no mutations | `features/today/TodayPage.tsx` (Pattern 33)                            |
| **List / worklist** | Records browsing, "what needs me now"           | `PageHeader` → `KpiStrip` → `PageToolbar` (search/tabs) → `ScrollArea` + `TableCard` + sticky header → `DetailSheet` on select               | `features/scheduled-orders/ScheduledOrdersPage.tsx`                    |
| **Dashboard / hub** | Landing "state of the clinic" overview          | `PageHeader` → `KpiStrip` (boxed in a `Card`) → bespoke card grid (`lg:grid-cols-[2fr_1fr]`, etc.). No `PageToolbar`/`TableCard`             | `features/dashboard/DashboardPage.tsx`                                 |
| **Wizard**          | Multi-step intake / Day-0 flows                 | `StepRail` (Pattern 5) → per-step form body → sticky save footer (Pattern 22)                                                                | `features/arrivals/ArrivalsPage.tsx`                                   |
| **Form-commit**     | Single-page data entry with a live commit panel | Two-column: scrollable form left, atomic-commit block (Pattern 3) right; sticky footer                                                       | `features/transactions/TransactionsCreatePage.tsx`                     |
| **Detail**          | A single record's full view                     | `DetailSheet` (Pattern 6) for the rail, OR a master-detail split (Patients); tabbed sections (Pattern 17)                                    | `features/patients/...` (split) · any list page's `DetailSheet` (rail) |

**Responsive contract (all archetypes).** Responsiveness lives in the
primitives, not per-page tweaks, so every page inherits it: `KpiStrip`
reflows with `auto-fit` (Pattern 10), `TableCard` scrolls a too-wide table
horizontally instead of clipping (Pattern 25), `PageHeader` wraps its action
group on narrow widths (Pattern 11). Content is centered and capped at
`max-w-screen-2xl`, relaxing to `max-w-shell` (1800px) at the `2xl`
breakpoint, by the AppShell — **pages must not add their own `max-w-*`**
(that re-introduces the off-center, half-empty look on 27" displays). The
primitives also take one width/density/type step at `2xl` (Pattern 31) so
the 27" display gets used, not just centered into. Build and screenshot at
**2560×1440** (the clinic's 27" Mac) first, then confirm it degrades
cleanly down to a tablet.

### Form surface — overlay vs page

Match a create/edit/action form to a surface by its size/complexity — **not**
"everything becomes a page":

| Form shape                                                             | Surface                  |
| ---------------------------------------------------------------------- | ------------------------ |
| Confirm / destructive yes-no                                           | `AlertDialog`            |
| 1–5 controls, one quick action                                         | `Dialog` (modal)         |
| ~6–12 controls, single group, edit-in-place                            | `Sheet` (`width="wide"`) |
| Multi-section, multi-step, ~15+ controls, or a full-entity create/edit | **Full page** (route)    |

Trigger for "page" is qualitative: multiple sections, steps, or doesn't fit
without heavy scrolling. Never nest overlays; use the same surface for create and
edit; gate irreversible commits (especially payments) behind a typed reason. The
**patient record + register/edit are full pages reached via search** (not a
672px sheet). The per-visit dose **Administer** action stays a fast overlay; the
first-visit **Arrivals wizard** stays a page. Full plan + per-form verdicts:
[`docs/handovers/archive/2026-05-31-ui-form-surface-redesign.md`](../../../docs/handovers/archive/2026-05-31-ui-form-surface-redesign.md).

---

## Theme identity tokens

The palette is SureVax's own — **clinical teal** primary on a faintly
cool canvas with a **dark ink-teal sidebar** — not stock shadcn
blue/white. All hues live in `src/index.css`; never restate them in
components (use the Tailwind token classes per `apps/frontend/CLAUDE.md`
"Never invent a color").

| Token group            | Value (HSL)                             | Carries                                                                                             |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `--primary` / `--ring` | `174 65% 27%` / `174 65% 32%`           | The ONE brand hue — CTAs, active accents, focus                                                     |
| `--background`         | `200 27% 98%`                           | Page canvas, deliberately 1 step off-white so `bg-card` surfaces (tables, KPI cells) read as layers |
| `--accent`             | `174 35% 93%`                           | Soft teal wash — hovers, selected rows                                                              |
| `--sidebar-*`          | ink `201 45% 10%`, accent `172 52% 44%` | The dark AppShell nav (Pattern 19) — sidebar-only, never for content surfaces                       |
| `--triage-*`           | unchanged                               | Severity semantics (Pattern 1) — **never follows brand changes**                                    |

Change protocol:

1. Edit the token in `index.css` only — components must keep using
   `bg-primary`, `text-sidebar-foreground`, etc.
2. Triage colors are semantic, not brand — re-theming primary must NOT
   touch `--triage-*`.
3. Keep sidebar contrast: `--sidebar-foreground` ≥ 80% lightness against
   the ~10%-lightness ink surface; verify the active inset bar
   (`--sidebar-primary`) reads at a glance.
4. The login page's dark panel uses `bg-foreground` — it inherits any
   foreground hue shift automatically; check it after re-theming.
5. `BranchKiosk` is an intentional zinc/dark override outside this
   system (see `apps/frontend/CLAUDE.md`) — leave it alone.

### Typography identity

Two self-hosted variable fonts (imported in `main.tsx` via
`@fontsource-variable/*` — no runtime network fetch):

| Face                        | Tailwind class | Carries                                                             |
| --------------------------- | -------------- | ------------------------------------------------------------------- |
| **Inter Variable**          | `font-sans`    | All UI text (body, labels, headings)                                |
| **JetBrains Mono Variable** | `font-mono`    | Facts — IDs, MRNs, money, doses, times, lot codes, eyebrows, deltas |

The mono face is the identity carrier: "mono for facts" (Pattern 8) is
what makes scanning clinical data feel instrument-like. Rules:

- Never hand-roll `font-family` in a component — `font-sans` / `font-mono`
  only. The stacks live in `tailwind.config.ts` (`theme.extend.fontFamily`)
  with system fallbacks; `.eyebrow` (index.css) carries its own matching
  mono stack.
- Pair `font-mono` with `tabular-nums` for any column of numbers.
- Don't add a third face without updating this section + the change
  protocol above. Display/serif faces are out — the app is an instrument,
  not a brochure.

#### Reading distance — why the dense steps aren't Tailwind's defaults

`text-2xs` / `text-xs` / `text-sm` are **11 / 13 / 15 px**, not the stock
10 / 12 / 14, and their line-heights moved with them (leading matters as much
as size for scanning). Retuned 2026-07-26.

A 2560-wide logical desktop across a 27" panel is ~109 CSS px per inch against
the 96 px/inch the CSS pixel is defined at, so every size rendered ~12% smaller
than "standard" — before accounting for a front desk being further from the
screen than a laptop. And `text-xs` is this app's dominant body size, not an
accent (796 uses vs 537 for `text-sm` at the time), so most text sat at the
12px floor while that floor rendered at roughly a 10.6px equivalent.

Consequences to know before changing anything here:

- **`text-sm` no longer means 14px.** That is deliberate. Redefining the
  tokens moved all 1,333 call sites at once without touching padding, so row
  density mostly survived (net ±1 row per page vs. before the density audit).
  Don't "fix" the values back to stock.
- **Don't reach for fluid/`vw` type instead.** Viewport width is a bad proxy
  for apparent size: a 13" 1440p laptop (~124 PPI) and the clinic's 27" 1440p
  monitor (~109 PPI) have identical viewport width, so `vw` scaling changes
  nothing about the actual problem. CSS cannot read PPI or viewing distance.
- If the app ever ships to genuinely mixed hardware, the mechanism is a
  persisted per-install preference (a `data-density` attribute on `<html>`
  driving token overrides), not viewport math.
- `.eyebrow` (index.css) is `0.6875rem` to match `text-2xs`. It was a
  hardcoded `10px` — the KPI label on every list page, below the documented
  body floor and immune to the scale. Keep it in rem.

---

## 1. Severity stripe + triage badge

**When:** any list row that represents work the user might need to do.

```tsx
<TableRow data-severity={row.severity} className="stripe">
  <TableCell>
    <Badge variant={row.severity}>{row.statusLabel}</Badge>
    <span>{row.title}</span>
  </TableCell>
  …
</TableRow>
```

`severity ∈ "overdue" | "due" | "ok" | "info"`. The `stripe` class (in
`src/index.css`) renders the 3 px left border. The `Badge` clinical
variants live on the same cva block as the stock variants in
`src/components/ui/badge.tsx`.

**Why not color the whole row?** Stripe scans at distance, doesn't
compete with text, and stays accessible at any background.

---

## 2. Worklist landing page

**When:** any "Patients", "Scheduled Orders", "Orders" route. Replaces "table of
every record".

Structure:

```
[ page header              actions ]
[ Tabs segmented control (severity filter + counts) ]
[ search / bulk action bar ]
[ Lane: Overdue   ──────────────────── ]
[ Lane: Due today ──────────────────── ]
[ Lane: Upcoming  (collapsible) ────── ]
```

Lane is `<section>` with a heading row (severity dot + title + count
Badge) and a list inside. Counts are computed from the same query that
drives the rows.

When a row is selected → opens `<Sheet>` rail on the right, _not_ a
modal.

---

## 3. Atomic-commit block

**When:** the action will write more than one record (intake →
encounter + orders + inventory + transaction; cashier commit →
payment + receipt + audit + clinical unlock).

Always render an "On commit" summary panel above the primary CTA
listing the effects.

```tsx
<Card>
  <CardHeader>
    <span className="eyebrow">On commit · single transaction</span>
    <CardTitle>4 things happen together</CardTitle>
    <CardDescription>Rolls back as one if any step fails.</CardDescription>
  </CardHeader>
  <CardContent>
    <ol>{/* numbered effects with severity dots */}</ol>
  </CardContent>
  <CardFooter>
    <Button variant="default" size="lg">
      Commit bundle <kbd>⌘↵</kbd>
    </Button>
  </CardFooter>
</Card>
```

Use `variant="default"` for the terminal action — the brand primary
already carries enough weight. Reserve `destructive` for irreversible
actions like void / refund.

---

## 4. Payment-gates-clinical

**When:** any clinical action whose preconditions include a paid
transaction (Day-0 ARV, ERIG administration).

Show a banner above the action area:

```tsx
<Alert data-blocked={!paid} variant="destructive">
  <Lock className="h-4 w-4" />
  <AlertTitle>Day-0 ARV blocked until payment commits</AlertTitle>
  <AlertDescription>
    TXN-2026-… · ₱4,820 unsettled. <Link to="…">Settle now</Link>
  </AlertDescription>
</Alert>
```

The clinical "Administer" button: `disabled={!paid}` AND visually
distinct vs unlocked (badge state, icon switch). The user should never
wonder _why_ the button is gray.

---

## 5. Multi-step wizard (StepRail)

**When:** ≥ 3 dependent steps that produce a single atomic write at
the end.

Layout:

- Left rail: numbered steps, current/done/locked states. Use
  `font-mono tabular-nums` for the numbers.
- Center: one step at a time, no progress overlap.
- Right rail: live "On commit" summary that fills in as steps complete.

Don't use a modal Tabs setup. Don't allow forward jumps. Steps are
gates.

Implemented with shadcn primitives only — `<Card>`, `<Button>`,
`<Separator>`. Steps are plain `<ol>` with
`data-state="done|current|locked"`. Canonical:
[`features/arrivals/StepRail.tsx`](../src/features/arrivals/StepRail.tsx).

---

## 6. Detail rail (Sheet, not Dialog)

**When:** clicking a row in a worklist.

**Use [`<DetailSheet>`](../src/components/layout/DetailSheet.tsx) — don't
hand-roll `<SheetContent side="right" className="...">` markup.** Three
width presets:

| Width      | Tailwind classes                                 | Use                                                                                                         |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `narrow`   | `w-full sm:max-w-md xl:max-w-lg 2xl:max-w-xl`    | Worklist detail — list stays usable side-by-side. ScheduledOrders, Appointments, ClinicalOrders, LabOrders. |
| `standard` | `w-full sm:max-w-xl xl:max-w-2xl 2xl:max-w-3xl`  | **Default.** Admin detail, patient detail, encounter detail, most pages.                                    |
| `wide`     | `w-full sm:max-w-2xl xl:max-w-3xl 2xl:max-w-4xl` | Form-heavy or commit-flow surfaces — Transactions, StandingOrder detail, InitiateProtocol.                  |

Each preset takes one extra step at `2xl` (Pattern 31) so rails use the
27" display's width instead of floating in dead space.

The sheet scrim is intentionally light (`bg-foreground/25`, near-clear
`2xl:bg-foreground/10` — set in `components/ui/sheet.tsx`): the pattern's
promise is that the list stays READABLE beside the rail, especially on
the 27" display. Don't restore shadcn's default `bg-black/80`.

**Worklist rails are non-modal at 2xl.** Host the rail with
[`<DetailRail>`](../src/components/layout/DetailRail.tsx) (a `Sheet`
root that sets `modal={false}` at the `2xl` breakpoint via `useIs2xl`):
no scrim, no focus trap, no scroll lock — the list stays fully
interactive and clicking another row switches the selection directly.
Below `2xl` it behaves as a normal modal sheet. Use `DetailRail` for
read/act detail rails on list pages; keep plain `<Sheet>` for edit-form
sheets where modal focus is a feature.

```tsx
import { DetailSheet } from '@/components/layout'
;<Sheet open={open} onOpenChange={setOpen}>
  <DetailSheet>
    {/* width="standard" by default */}
    <SheetHeader className="px-6 py-4 border-b border-border">
      <SheetTitle>Patient detail</SheetTitle>
    </SheetHeader>
    <div className="flex-1 overflow-y-auto px-6 py-4">…</div>
  </DetailSheet>
</Sheet>
```

Three vertical sections inside the sheet:

1. **Header** — patient/record identity, status badges
2. **Body** — grouped sections, every DB column rendered (em-dash for
   null, `JSON.stringify(v, null, 2)` in `<pre>` for JSONB, mask sensitive
   keys: `api_key`, `secret`, `token`, `password`, `auth`, `credential`)
3. **Footer** — primary action (only when the Sheet has actions)

Reasoning: list-and-detail compares well; modals lose context.

If the detail has an **edit mode** with a meaningfully long form, use
the sticky-save-footer variant from Pattern 22 — `DetailSheet` already
sets `flex flex-col`, so a sticky `<footer>` sibling sticks correctly.

Canonical: any `*Detail.tsx` under `src/features/*/components/` —
[`PatientDetail.tsx`](../src/features/patients/components/PatientDetail.tsx)
is the most-grouped example.

---

## 7. Command palette (⌘K)

**When:** the global navigator AND global patient search. Always-on,
keyboard-first.

Typing ≥2 characters live-searches patients via the existing
`usePatientSearch` hook (`/api/patients?q=&limit=10`); hits render in a
"Patients" group above page navigation as "Lastname, Firstname" + MRN
(mono), and selecting one navigates to `/patients/:id`. Page/action
items still filter client-side via cmdk. Patient `CommandItem`s must
include name + MRN + id in their `value` so fetched hits survive cmdk's
client-side filter pass (see `AppShell.tsx`).

Use shadcn `<CommandDialog>`
([`src/components/ui/command.tsx`](../src/components/ui/command.tsx)).
Three groups in order:

1. **Jump to** — routes
2. **Actions** — verbs (New patient, New transaction, End shift)
3. **Today's priorities** — top 3-5 nudges from today's worklist, with
   severity dots

The third group is unique to SureVax — it makes the command palette a
_worklist surface_, not just a router.

---

## 8. Mono for facts

Apply `font-mono tabular-nums` to:

- IDs (`PT-2024-8821`)
- Times (`09:42`, `14:00`)
- Dates in shorthand (`28 Apr`)
- Money (`₱4,820.00`)
- Doses (`0.1 mL ID`, `2,080 IU`)
- Lot codes (`SR-118`)
- Counts in dense tables

The Tailwind `font-mono` stack is the stock default — no custom font
loading required.

---

## 9. Eyebrow labels

Small section labels above headings use the `.eyebrow` utility from
`src/index.css`:

```tsx
<span className="eyebrow">Today's priorities</span>
<h2>Today's scheduled queue</h2>
```

Mono, 11 px, uppercase, wide tracking, muted. Use it instead of
redundant `<h3>`s when you want a section label without a full heading.

---

## 10. KPI strip — flush, ruled, not card-soup

When showing top-of-page metrics (Arrivals today, Scheduled due, Drawer
balance), use one ruled strip — not 4-5 separate Cards. Information is
comparable; visual treatment should reflect that.

The strip is **intrinsically responsive**: cells lay out with
`repeat(auto-fit, minmax(min(100%, 12rem), 1fr))`, so they fan out across a
wide 27" display and wrap onto new rows on a laptop, tablet, or half-screen
window — no fixed column count, no breakpoints, no value/badge overlap. The
ruled dividers are a 1px `bg-border` grid gap between opaque cells, which
stays clean whether the strip is one row or several. The `columns` prop is
**deprecated** (layout no longer pins a count); tune the wrap threshold via
`minColWidth` if a strip carries unusually wide values.

**Use [`<KpiStrip>`](../src/components/layout/KpiStrip.tsx) +
[`<KpiCell>`](../src/components/layout/KpiCell.tsx) — don't hand-roll
the grid.**

```tsx
import { KpiStrip, KpiCell } from '@/components/layout'
;<KpiStrip>
  <KpiCell label="Due today" value={stats.todayCount} subtitle="14 orders" />
  <KpiCell label="Overdue" value={stats.overdueCount} subtitle="need attention" tone="overdue" />
  <KpiCell label="Awaiting payment" value={0} subtitle="blocked until settled" />
  <KpiCell label="Ready" value={ready} subtitle="paid · in stock" tone="ok" />
</KpiStrip>
```

---

## 11. Page head

**When:** top of every route. Replaces ad-hoc `<h1>` + `<p>` + button
spaghetti.

**Use [`<PageHeader>`](../src/components/layout/PageHeader.tsx) — don't
hand-roll the title row.** Title type is `text-xl 2xl:text-2xl
font-semibold tracking-tight` (confident ramp, 2026-06-12 pass) — owned
by the primitive. The outer wrapping div (padding + bottom
border) stays at the call site so pages can compose KPI strips and
filter rows underneath inside the same wrapper.

```tsx
import { PageHeader } from '@/components/layout'
;<div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border">
  <PageHeader
    title="Page Title"
    description={`${count} due today · ${overdue} overdue`}
    actions={
      <>
        <Button variant="outline" size="sm">
          <Icon className="h-3.5 w-3.5 mr-1.5" />
          Secondary
        </Button>
        <Button size="sm">
          <Icon className="h-3.5 w-3.5 mr-1.5" />
          Primary action
        </Button>
      </>
    }
  />
  {/* optional KpiStrip / search row / filter tabs follow inside this same wrapper */}
</div>
```

**Button order** is non-negotiable: secondary actions left
(`variant="outline"`: Export, Filter, Print, History), primary CTA
rightmost (default variant). Icons are always `h-3.5 w-3.5 mr-1.5`,
buttons are always `size="sm"` in page heads. The container is always
`flex items-center gap-2 shrink-0` so it stays beside the title block
on narrow viewports.

Subtitles carry live counts from the data hook — they replace
decorative text. Actions sit right-aligned, same baseline as the h1.

Canonical: every list page in the app — `DashboardPage.tsx`,
`PatientsPage.tsx`, `InventoryPage.tsx`, `TransactionsPage.tsx`,
`ScheduledOrdersPage.tsx`, `ClinicalOrdersPage.tsx`,
`LabOrdersPage.tsx`, `ServicesPage.tsx`, all `admin/*Page.tsx`.

---

## 12. Roster table (Dashboard arrivals)

**When:** the Dashboard arrivals table. Replaces the generic "Today's
arrivals" table.

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead className="w-[78px]">Time</TableHead>
      <TableHead>Patient</TableHead>
      <TableHead>Protocol · Step</TableHead>
      <TableHead className="w-[110px]">Allergies</TableHead>
      <TableHead className="w-[220px]">Next action</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {rows.map((r) => (
      <TableRow key={r.id} className="clickable cursor-pointer hover:bg-accent/50">
        <TableCell>
          <div className="font-mono text-[13px]">{r.time}</div>
          {r.waitMinutes != null && (
            <div className="text-xs text-muted-foreground mt-0.5">
              waited{' '}
              <span className={r.waitMinutes > 20 ? 'font-medium text-triage-overdue' : ''}>
                {r.waitMinutes}m
              </span>
            </div>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <span className="text-sm font-medium">{r.patientName}</span>
              <span className="text-xs text-muted-foreground font-mono ml-1">{r.mrn}</span>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <div className="text-[13px]">{r.protocol}</div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">{r.step}</div>
        </TableCell>
        <TableCell>
          {r.allergies?.map((a) => (
            <Badge key={a} variant="destructive" className="mr-1">
              {a}
            </Badge>
          )) || <span className="text-xs text-muted-foreground">—</span>}
        </TableCell>
        <TableCell>
          {r.nextAction ? (
            <Button size="sm" variant={r.nextActionTone}>
              {r.nextAction}
            </Button>
          ) : (
            <Badge variant={r.statusVariant}>{r.status}</Badge>
          )}
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

Key design choices: Patient column shows avatar + name + MRN on two
lines. Wait time turns triage-overdue when >20m. Allergy badges use
`variant="destructive"`. The last column is either a CTA button or a
status Badge — never both.

Canonical: `DashboardPage.tsx` arrivals table.

---

## 13. Dose strip (PEP visualization)

**When:** any patient or protocol view that shows standing-order dose
progress (D0, D3, D7, D14 — or "Dose N" courses). Replaces text-only
"D0 done, D3 due…" and ad-hoc count badges.

**Use [`<DoseStrip>`](../src/components/clinical/DoseStrip.tsx) from
`@/components/clinical` — don't hand-roll dose dots.** It renders
connected nodes: **done** = filled `triage-ok` with a check, **due** =
amber ring, **overdue** = red ring, **upcoming** = hollow. The rail
segment leading into a node turns green when the previous dose is done,
so completed progress reads as a continuous line.

```tsx
import { DoseStrip } from '@/components/clinical'

// Detail rail / protocol card — labeled nodes
<DoseStrip
  doses={[
    { label: 'D0', state: 'done', detail: 'Jun 9 · SR-118 · Maria Santos' },
    { label: 'D3', state: 'due' },
    { label: 'D7' },
    { label: 'D14' },
  ]}
/>

// Table cell — compact, tooltip carries the info
<DoseStrip size="sm" doses={doses} />
```

States: `done | due | overdue | '' (upcoming)` — severity-semantic
(triage tokens), never brand-colored. `detail` renders as the tooltip's
second line (date, lot, clinician). Strips longer than ~8 doses don't
scan — fall back to a count badge (see `PatientList.tsx`).

The **vertical** protocol timeline (dose-by-dose history with notes,
`ScheduledOrderDetail.tsx`) is a different surface — dots + rail `<ol>`
markup, not this primitive.

Canonical: `PatientDetail.tsx` active protocol card,
`PatientList.tsx` schedule column.

---

## 14. Receipt preview

**When:** transaction detail or create page showing a receipt-like
summary of line items, subtotal, tax, total, and tender.

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-sm">Receipt preview</CardTitle>
    <CardDescription>TXN-2026-K9MX3VQ2P5</CardDescription>
  </CardHeader>
  <CardContent>
    <pre className="font-mono text-xs bg-muted/40 border border-dashed border-border rounded-md p-3.5 whitespace-pre-wrap leading-relaxed">
      {`SUREVAX QC-01
Brgy. Diliman, Quezon City
TIN 009-123-456-789

May 4, 2026  10:11
Cashier: Maria Cruz
Patient: Reyes, Jose D. · P-018342

Consultation              ₱500.00
ARV Verorab IM × 1      ₱1,150.00
  Lot RB-2204
─────────────────────────
Subtotal                ₱4,320.00
VAT-exempt              −₱432.86
─────────────────────────
TOTAL DUE               ₱4,250.00
─────────────────────────
TENDERED · cash        ₱5,000.00
CHANGE                    ₱750.00`}
    </pre>
    <div className="flex items-center gap-2 mt-3">
      <Button size="sm" variant="outline">
        Print
      </Button>
      <Button size="sm" variant="outline">
        Email
      </Button>
      <Button size="sm" variant="outline">
        SMS
      </Button>
    </div>
  </CardContent>
</Card>
```

Use `font-mono` for the entire receipt block. Dashed border
(`border-dashed`) distinguishes it from data-entry cards. Line items
are left-aligned, amounts right-aligned with monospaced alignment.
Separator rows use em-dash or box-drawing characters.

Canonical: `TransactionsPage.tsx` receipt preview card.

---

## 15. Cold-chain unit cards

**When:** Inventory page top section showing fridge/freezer health.
Replaces a flat list of units.

```tsx
<div className="grid grid-cols-2 gap-4">
  {units.map((u) => (
    <Card key={u.id}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
            {u.id}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{u.name}</p>
            <p className="text-xs text-muted-foreground">{u.lots}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono font-medium text-sm">{u.temp}</span>
            <Badge variant={u.status === 'normal' ? 'ok' : 'due'}>{u.status}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  ))}
</div>
```

Phase 1 hardcoded units: A1 (Rabies fridge, 4.2°C), A2 (RIG fridge,
5.1°C), B1 (Routine fridge, 3.8°C), B2 (HPV/specialty, 6.5°C). Each
card shows fridge ID as a circular avatar, name + lot count, temp in
mono, and a status badge (normal → ok green, low stock → due amber).

Canonical: `InventoryPage.tsx` cold-chain section.

---

## 16. Shift menu dropdown

**When:** Dashboard or any page where the active shift needs quick
actions (print EOD, close drawer, end shift).

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm">
      Shift
      <ChevronDown className="h-3 w-3 ml-1" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-52">
    <DropdownMenuItem>
      <Printer className="h-4 w-4 mr-2" />
      Print EOD report
    </DropdownMenuItem>
    <DropdownMenuItem>
      <Banknote className="h-4 w-4 mr-2" />
      Close drawer #12
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem className="text-destructive">
      <LogOut className="h-4 w-4 mr-2" />
      End shift
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Position: right-aligned in the page-head actions area. The "End shift"
option is destructive — it's irreversible and should prompt confirmation.

Canonical: `DashboardPage.tsx` page-head actions.

---

## 17. Patient detail tabs

**When:** patient detail page (not the list). Replaces a flat card
layout with tabbed navigation.

```tsx
<div className="flex border-b border-border -mb-px gap-0">
  {[
    { id: 'overview', label: 'Overview' },
    { id: 'timeline', label: 'Timeline', count: 23 },
    { id: 'protocols', label: 'Protocols', count: 1 },
    { id: 'docs', label: 'Documents', count: 4 },
    { id: 'billing', label: 'Billing', count: 1, alert: true },
  ].map((t) => (
    <button
      key={t.id}
      onClick={() => setTab(t.id)}
      className={cn(
        'px-3.5 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors',
        tab === t.id
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {t.label}
      {t.count != null && (
        <span
          className={cn('ml-1 text-xs', t.alert ? 'text-triage-overdue' : 'text-muted-foreground')}
        >
          · {t.count}
          {t.alert ? ' unpaid' : ''}
        </span>
      )}
    </button>
  ))}
</div>
```

Active tab gets a 2 px primary bottom border. Counts are inline after
the label, prefixed with `·`. Unpaid billing count renders in
triage-overdue to draw attention. The tab bar sits directly above the
tab content — no Card wrapper around the tabs themselves.

Canonical: `PatientDetail.tsx` tab bar.

---

## 18. KPI cell anatomy

**When:** any cell inside the ruled KPI strip (Pattern #10). Provides
consistent structure for the 4–5 metric cells.

```tsx
<div className="p-3 2xl:p-4">
  <span className="eyebrow">{label}</span>
  <p className="text-2xl 2xl:text-3xl font-semibold font-mono tabular-nums mt-0.5">{value}</p>
  <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
</div>
```

Three layers: eyebrow label (11 px uppercase mono), value (2xl
semibold, mono, tabular-nums — steps to 3xl at the `2xl` breakpoint,
Pattern 31), subtitle (xs muted). Color the value text with
`text-triage-overdue` / `text-triage-ok` / `text-triage-due` when the
number carries severity meaning. Never color a number red just because
it's "bad" — use the triage token that matches the clinical meaning.

Optional context props: `trend` (number[] series, oldest → newest)
renders an inline `<Sparkline>` (Pattern 32) beside the value; `delta`
(pre-formatted text like "+3 vs last week") renders a mono line under
the value with `deltaTone` severity. Both need backend-supplied series
— never synthesize a trend from a single snapshot.

Canonical: KPI strips on `DashboardPage.tsx`, `InventoryPage.tsx`,
`TransactionsPage.tsx`, `ScheduledOrdersPage.tsx`,
`ClinicalOrdersPage.tsx`, `LabOrdersPage.tsx`, `ServicesPage.tsx`.

---

## 19. AppShell sidebar

**When:** the persistent left navigation. A **dark ink-teal rail**
driven entirely by the `--sidebar-*` tokens (2026-06-12 revamp — see
"Theme identity tokens" above). The dark rail anchors wayfinding on the
27" front-desk display while content surfaces stay light; it also
harmonizes with the login page's dark brand panel.

Structure (see `AppShell.tsx`):

```
┌─────────────────────┐
│ SV  SureVax          │  ← brand (logo + name + branch subtitle)
│     QC-01 · QC       │
├─────────────────────┤
│ TODAY                │  ← group label (10px uppercase, fg/50)
│  Dashboard           │
│  New Arrival         │  ← nav items (14px, hover bg-sidebar-accent)
│  Patients            │     active: bg-sidebar-accent + teal left bar
│  …                   │
├─────────────────────┤
│ ADMINISTRATION       │  ← group label (admin only)
│  Users               │
│  …                   │
├─────────────────────┤
│ [AV] Maria Cruz   ↪  │  ← session card (border, rounded-lg)
│      Nurse · QC-01   │     clickable → DropdownMenu
└─────────────────────┘
```

Key details — every color comes from a `sidebar-*` token class, never
from content-surface tokens (`bg-card`, `text-muted-foreground`, …):

- Sidebar: `bg-sidebar text-sidebar-foreground border-r border-sidebar-border w-56 xl:w-64 2xl:w-72`
- Brand: logo square (7×7, `bg-sidebar-primary text-sidebar-primary-foreground`, "SV"), name + branch subtitle (`text-sidebar-foreground/60`)
- Group labels: `text-2xs font-medium uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground`
- Nav items: `flex gap-3 h-9 rounded-md px-3 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground`
- Active nav: `bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_0_hsl(var(--sidebar-primary))]` — the inset shadow is the teal accent bar; the item icon flips to `text-sidebar-primary`
- Focus rings inside the rail: `focus-visible:ring-sidebar-ring` (not `ring-ring`)
- Session card: `border border-sidebar-border rounded-lg p-3 hover:bg-sidebar-accent/60` with Avatar (`bg-sidebar-primary`) + name + role + LogOut icon, wrapped in DropdownMenuTrigger
- Mobile drawer (`Sheet side="left"`) reuses the same tokens — `bg-sidebar text-sidebar-foreground border-sidebar-border`
- Topbar (sibling, NOT part of the rail): `bg-card border-b` — a white chrome surface above the faintly tinted page canvas
- Search bar (topbar): clickable `<button>` that opens CommandDialog via Cmd+K
- CommandDialog groups: Navigate (routes), Administration (admin routes), Actions (new arrival, new transaction, shortcuts)

Canonical: `AppShell.tsx`.

---

## 20. Sticky table column headers

**When:** any worklist table that may scroll vertically. (All of them —
data grows, your screenshot doesn't.)

Apply `sticky top-0 bg-card z-10` to the column-header row. Three
variants depending on what the page uses:

```tsx
// shadcn <Table>
<TableHeader className="sticky top-0 bg-card z-10">…</TableHeader>

// raw <thead>
<thead className="sticky top-0 bg-card z-10">…</thead>

// grid-based "fake table" header row
<div className="grid grid-cols-[…] sticky top-0 bg-card z-10 …">…</div>
```

The element must sit at the top of a scroll container (`<ScrollArea>`
or `overflow-y-auto` div) for `top-0` to work — sticky is relative to
the nearest scrolling ancestor, not the viewport. Use `bg-card` so the
header isn't transparent over scrolling rows; `z-10` keeps it above
hover/focus states. If the existing header has a `border-b`, keep it —
it visually separates the sticky header from rows during scroll.

Canonical: every list page —
[`ServicesPage.tsx`](../src/features/services/ServicesPage.tsx) (grid
variant), the operational pages from #201, the admin pages from #202,
the missed-pages sweep from #208.

---

## 21. Empty state (canonical layout)

**When:** a list/table renders with zero rows — search miss, freshly
seeded tenant, filter that excludes everything.

**Use [`<ListEmpty>`](../src/components/layout/ListEmpty.tsx) — don't
hand-roll the markup.**

```tsx
import { ListEmpty } from '@/components/layout'
;<ListEmpty icon={Users} message="No users found." />
```

Pick `{Icon}` from lucide-react semantically (`Stethoscope` for
encounters, `Receipt` for transactions, `Users` for users, etc.). Copy
is always _"No {plural-entity} found."_ unless the page has a
specifically-different intent (e.g. transactions/new's
_"Search for a patient to load encounter context"_ — that's an
**unselected** state, not an empty state).

Don't render the empty state inside the table body (`<TableRow>` →
`<TableCell colSpan={N}>`) — it's centered awkwardly and doesn't get
the icon. Render the empty state **above/instead-of** the table when
data is empty.

Canonical:
[`ServicesPage.tsx`](../src/features/services/ServicesPage.tsx),
[`AppointmentsPage.tsx`](../src/features/appointments/AppointmentsPage.tsx),
[`AdverseEventsPage.tsx`](../src/features/adverse-events/AdverseEventsPage.tsx).

---

## 22. Sticky save footer (one-page forms)

**When:** any single-page form/wizard where the primary CTA could
scroll out of view. Settings tabs, Standing-Orders wizard, any detail
Sheet with edit mode.

Don't put the Save button inside the scrolling content. Split the
container into header / scroll-body / sticky-footer:

```tsx
<div className="h-full flex flex-col">
  {/* sticky header */}
  <div className="px-6 py-4 border-b border-border shrink-0">…</div>

  {/* scroll body */}
  <ScrollArea className="flex-1">
    <div className="px-6 py-5 space-y-4 max-w-5xl">…form content…</div>
  </ScrollArea>

  {/* sticky footer */}
  <footer className="border-t border-border bg-card px-6 py-3 flex items-center justify-end gap-2 shrink-0">
    <Button variant="ghost" onClick={onCancel}>
      Discard
    </Button>
    <Button onClick={onSubmit}>Save changes</Button>
  </footer>
</div>
```

Same pattern inside a `<Sheet>` — make `<SheetContent>` `flex flex-col`
and place the footer as a sibling of the scroll body.

If the form has multiple wizard steps, also pin the step rail at the
top of the scroll body (`sticky top-0 z-10 bg-background`) so users
keep their orientation. A "Selected: {name} [Change]" chip below the
rail is a useful affordance for long wizards.

Canonical:
[`SettingsPage.tsx`](../src/features/settings/SettingsPage.tsx) (split
header/body/footer),
[`InitiateProtocolPage.tsx`](../src/features/standing-orders/InitiateProtocolPage.tsx)
(sticky rail + sticky CTA footer),
[`TransactionsCreatePage.tsx`](../src/features/transactions/TransactionsCreatePage.tsx)
(sticky right-rail commit panel — variant for wide desktop).

---

## 23. Disabled stub button with tooltip

**When:** a CTA exists in the design but the implementation is not
yet wired up. Don't remove the button (users lose visibility into the
roadmap), don't leave it silently no-op (looks broken).

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <span tabIndex={0} className="block">
      <Button variant="outline" size="sm" disabled>
        Generate
      </Button>
    </span>
  </TooltipTrigger>
  <TooltipContent>Coming soon — report engine in development</TooltipContent>
</Tooltip>
```

The `<span tabIndex={0}>` wrapper is required — disabled buttons don't
fire hover/focus events on most browsers, so the tooltip wouldn't show
otherwise. The page using these tooltips must wrap its tree in
`<TooltipProvider>` (typically at page-component root).

Canonical:
[`ReportsPage.tsx`](../src/features/reports/ReportsPage.tsx) — every
"Generate" card uses this pattern.

---

## 25. List page shell — table card + toolbar + max-width

**When:** every route that's primarily a list/table of records (admin
pages, ops pages). Replaces ad-hoc page layouts.

Three layout primitives compose the shell:

```tsx
import { PageHeader, KpiStrip, KpiCell, PageToolbar, TableCard } from '@/components/layout'

<div className="h-full flex flex-col">
  {/* Header */}
  <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border">
    <PageHeader title="…" description="…" actions={…} />
  </div>

  {/* Optional KPI strip */}
  <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border">
    <KpiStrip columns={4}>…</KpiStrip>
  </div>

  {/* Filter / search / tabs */}
  <PageToolbar>
    <Input placeholder="Search…" />
    <Tabs>…</Tabs>
  </PageToolbar>

  {/* Table — wrapped in TableCard so it's never edge-to-edge */}
  <ScrollArea className="flex-1">
    <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
      <TableCard>
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">…</TableHeader>
          <TableBody>…</TableBody>
        </Table>
      </TableCard>
    </div>
  </ScrollArea>
</div>
```

**[`<PageToolbar>`](../src/components/layout/PageToolbar.tsx)** owns
toolbar padding (`px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b`) and inner flex
layout. Use `layout="stacked"` when filters need multiple sub-rows.

**[`<TableCard>`](../src/components/layout/TableCard.tsx)** wraps the
table in a rounded card (`rounded-lg border bg-card overflow-hidden`)
so tables never sit flush against the page edges. Works with shadcn
`<Table>` OR raw `<table>` — the visual treatment is identical.

**Surface zones (2026-06-12 pass).** Page chrome — the header band, KPI
band, and `PageToolbar` — sits on `bg-card` (white); the scroll canvas
stays on the tinted `bg-background`; tables float on it as
`TableCard` (`bg-card` + `shadow-sm`). Three zones, one elevation step
each — this replaced the old all-tinted "hairline band sandwich". The
canonical chrome wrapper is
`px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card`
(`py-3` for the KPI band). Don't put `bg-card` on the scroll canvas.

**Page max-width** is enforced globally at the AppShell `<Outlet>`
wrapper (`max-w-screen-2xl 2xl:max-w-shell mx-auto` — 1536 px, relaxing
to 1800 px at the `2xl` breakpoint; `max-w-shell` is defined in
`tailwind.config.ts`). The topbar above stays edge-to-edge; only route
content is capped. Pages that need a different cap (Dashboard's wider
`max-w-7xl` for KPI density, VitalsDemoPage's narrow `max-w-2xl`) apply
their own constraint inside.

Don't hand-roll `<div className="border rounded-md overflow-hidden">`
around a table — use `<TableCard>`. Don't hand-roll
`<div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border flex
items-center gap-3">` for a toolbar — use `<PageToolbar>`.

Canonical: [`UsersPage.tsx`](../src/features/admin/UsersPage.tsx),
[`AuditPage.tsx`](../src/features/admin/AuditPage.tsx).

---

## Anti-patterns (and what to do instead)

| Don't                                                     | Do                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Render a status with a colored row background             | Use `<Badge variant=…>` + `stripe`                                      |
| Use `Dialog` for a record detail                          | Use `<Sheet side="right">`                                              |
| Ship 5 sibling Cards as a KPI grid                        | One Card with vertical rules                                            |
| Color a number red to mean "bad"                          | Mono + sign + Badge — colors mean severity, not value                   |
| Wrap a `Button` in a `BrandButton`                        | Add a variant to `button.tsx`                                           |
| Use raw hex / oklch in components                         | Add a token to `index.css`, expose in `tailwind.config.ts`              |
| Hardcode page subtitle text                               | Wire live counts from data hook (e.g. "14 orders · 4 overdue")          |
| Skip the page-head pattern                                | Every route gets `<h1>` + subtitle + actions row                        |
| Use separate Cards for KPI cells                          | One Card, `divide-x`, eyebrow + value + subtitle per cell               |
| Put nav items in a flat list without labels               | Use group labels ("Operations", "Administration")                       |
| Let a long table scroll without sticky header             | `sticky top-0 bg-card z-10` on `<TableHeader>`/`<thead>`                |
| Center an empty-state message in a TableRow               | Render the empty state above the table, with icon + copy                |
| Put primary Save inside a scrolling form                  | Split into header / body / sticky `<footer>` (Pattern 22)               |
| Leave a CTA visually-enabled but no-op                    | `disabled` + `<Tooltip>` "Coming soon" wrapper (Pattern 23)             |
| Place primary CTA leftmost in the page head               | Secondary actions left, primary CTA rightmost (Pattern 11)              |
| Wrap a disabled `<Button>` directly in `<TooltipTrigger>` | Wrap in `<span tabIndex={0}>` first (Pattern 23)                        |
| Fetch all records on mount                                | Use `useRecentList` — recent 50 by default, search narrows (Pattern 24) |

---

## Pattern 24: Search-first records browse (recent + search + load older)

**Goal:** Pages default to the 50 most-recent records. A search input narrows
the list. A "Load older" button appends the next cursor page.

### Hook

`apps/frontend/src/lib/useRecentList.ts` — `useRecentList<TRow>(opts)`

```ts
const { rows, totalCount, hasMore, loadMore, isLoading } = useRecentList<Patient>({
  endpoint: '/api/patients',
  query: { q: searchTerm }, // undefined values are omitted from the request
  queryKey: ['patients', searchTerm],
  pageSize: 50, // default; max 200
})
```

| Return field | Type             | Description                                                              |
| ------------ | ---------------- | ------------------------------------------------------------------------ |
| `rows`       | `TRow[]`         | Accumulated rows across all loaded pages                                 |
| `totalCount` | `number \| null` | From `X-Total-Count` header (captured on first page, stable until reset) |
| `hasMore`    | `boolean`        | True when last page returned `X-Next-Cursor`                             |
| `isLoading`  | `boolean`        | True while any page fetch is in flight                                   |
| `isError`    | `boolean`        | True on non-2xx response                                                 |
| `error`      | `unknown`        | The caught error (use `apiErrorMessage(error)` to display)               |
| `loadMore()` | `() => void`     | Fetches next page; no-op when `!hasMore` or already loading              |
| `reset()`    | `() => void`     | Clears pages, refetches from beginning                                   |

### Backend requirements

Each list endpoint must:

1. Accept `?cursor=<opaque>&limit=<n>` query params (`limit` default 50, max 200).
2. Return `X-Total-Count: <n>` — count matching filters, ignoring cursor/limit.
3. Return `X-Next-Cursor: <opaque>` when more pages exist; omit when on last page.
4. Keep response body shape unchanged (bare array or `{data:[...]}` — hook handles both).

**Cursor scheme (all 5 endpoints):** base64(`"<timestamp_iso>|<id>"`).
Ordering: `(timestamp DESC, id DESC)`. Timestamp column varies by table:

| Endpoint                       | Timestamp column |
| ------------------------------ | ---------------- |
| `GET /api/patients`            | `created_at`     |
| `GET /api/admin/audit`         | `timestamp`      |
| `GET /api/admin/notifications` | `created_at`     |
| `GET /api/admin/approvals`     | `requested_at`   |
| `GET /api/admin/attendance`    | `clock_in_at`    |

### Usage notes

- `queryKey` must include every variable that affects `endpoint` or `query` so
  the hook resets when filters change.
- `totalCount` is updated only on the first page load (or after `reset()`).
  It is suitable for a badge like `"142 patients"` but not as a live count.
- The hook does not integrate with React Query's cache. It uses raw `fetch`
  internally so it can read response headers. Passing a `queryKey` is for
  reset-on-change semantics, not cache sharing.

---

## Pattern 25: List-page shell — TableCard + PageToolbar

**Goal:** Every list/table route uses the same outer shell — toolbar row
between the page head and the table, table wrapped in a rounded card with
consistent outer padding. Replaces hand-rolled
`<div className="border rounded-md overflow-hidden">` table wrappers and
inline `flex` filter rows.

### Primitives

- `<TableCard>` — rounded-card wrapper around a list `<Table>` or grid
  fake-table. Owns the border + `bg-card` background. Callers provide the
  outer padding (`px-4 sm:px-6 xl:px-8 2xl:px-10 py-4`) and the scroll container.
- `<PageToolbar>` — filter/search/tabs row. Owns outer padding
  (`px-4 sm:px-6 xl:px-8 2xl:px-10 py-3`) and the bottom border. Two layouts: `row`
  (default, flex-wrap) and `stacked` (vertical, for multi-row filter
  composes like the Audit Log).

```tsx
import { PageHeader, PageToolbar, TableCard, KpiCell, KpiStrip } from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'

;<div className="h-full flex flex-col">
  <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border">
    <PageHeader title="…" description="…" actions={…} />
  </div>
  <PageToolbar>{/* search input + Tabs + chips */}</PageToolbar>
  <ScrollArea className="flex-1">
    <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
      <TableCard>
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">…</TableHeader>
          <TableBody>{/* rows or <ListEmpty> */}</TableBody>
        </Table>
      </TableCard>
    </div>
  </ScrollArea>
</div>
```

Page content is globally capped at `max-w-screen-2xl` by the AppShell
`<Outlet>` wrapper — pages don't apply max-width themselves. The CI
script `scripts/check-design-system.sh` rejects hand-rolled
`border rounded-md` table wrappers and inline `<div className="px-… py-…
flex items-center gap-3 …">` toolbar rows; use the primitives.

---

## Pattern 26: Multi-section form headers

**Goal:** Multi-section forms (Patient register, Edit user, AEFI report)
group fields into `<Card>` sections. Section headers read as muted
eyebrows, not page titles — so they don't compete with the page `<h1>`.

### Primitive

`<FormSectionHeader>` wraps `<CardHeader>` + `<CardTitle>` with the
canonical eyebrow treatment (`text-sm font-semibold uppercase
tracking-wide text-muted-foreground`).

```tsx
import { FormSectionHeader } from '@/components/layout'

;<Card>
  <FormSectionHeader>Identity</FormSectionHeader>
  <CardContent>{/* First name, Last name, DOB, Sex */}</CardContent>
</Card>
<Card>
  <FormSectionHeader>Address</FormSectionHeader>
  <CardContent>{/* Region cascade + street */}</CardContent>
</Card>
```

Don't hand-roll the eyebrow classes per-section — drift creeps in
(weight, tracking, color) and the search-and-replace cost is real.
Single primitive owns the look.

---

## Pattern 27: Inline error banner

**Goal:** When a query fails (4xx/5xx, network error), the surface that
hosts the data — detail rail, page body, card content — renders an
inline banner with the AlertCircle icon + destructive copy. Replaces
the hand-rolled `<AlertCircle /> + 'Failed to load X.'` pair that drifts
in icon size, color, and spacing across screens.

### Primitive

`<ErrorBanner message="…" className="…" />` from `@/components/layout`.

```tsx
import { ErrorBanner } from '@/components/layout'

if (error) {
  return <ErrorBanner message="Failed to load order." className="p-6" />
}
```

| Surface          | className                         |
| ---------------- | --------------------------------- |
| Detail panel     | `p-6`                             |
| Centered surface | `py-12 justify-center`            |
| Inline card body | _(empty — defaults to flush row)_ |

Use the message-only `apiErrorMessage(error)` helper to extract a
readable string from an `ApiError`. Always surface SOMETHING — silent
empty states for a failed query were the #1 workflow finding in the
2026-05-17 audit (Day Summary, Notifications, Administer-dose all
rendered blank when the API errored).

---

## Pattern 28: Error boundary + 404 catch-all

**Goal:** A render-time React error never blanks the entire app, and a
typo'd URL never silently redirects to the Patients list.

### Primitives

- `<ErrorBoundary>` (class component) wraps `<Outlet />` in AppShell.
  Catches descendant render errors via `componentDidCatch` /
  `getDerivedStateFromError`. Renders `<ErrorBanner>` + a "Refresh page"
  button. React error boundaries still require a class component for
  `componentDidCatch`.
- `<NotFoundPage>` is rendered by the `path="*"` route. Title + muted
  copy + "Back to dashboard" button. The previous behavior was a silent
  fallback to the Patients list, which made stale bookmarks and typos
  hard to diagnose.

```tsx
// App.tsx
import { ErrorBoundary, NotFoundPage } from '@/components/layout'
;<Routes>
  <Route
    element={
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    }
  >
    {/* all authenticated routes */}
  </Route>
  <Route path="*" element={<NotFoundPage />} />
</Routes>
```

Detail rails wrap their own queries in `<ErrorBoundary>` too — a single
malformed record shouldn't tear down the surrounding list. The boundary
inside a rail catches the error, the rail surfaces `<ErrorBanner>`, and
the list keeps rendering.

---

## Pattern 29: Sortable list-page columns

**Goal:** Any list page can opt into column sorting with URL-state
persistence. Tri-state cycle on the active column (asc → desc → cleared),
single-column sort, encoded as `?sort=<col>&order=asc|desc`.

### Primitives

- `useTableSort(opts?)` — hook returning `{ sort, toggleSort }`. Reads
  `?sort` and `?order` from URL; `toggleSort(col)` cycles state and
  writes back via `setSearchParams(..., { replace: true })`.
- `<SortableHead col sort onToggle>{label}</SortableHead>` — wraps
  shadcn's `<TableHead>` with click affordance and `aria-sort`
  attribute. Renders neutral double-chevron when not active, up-chevron
  for asc, down-chevron for desc.

### Usage

```tsx
import { SortableHead } from '@/components/layout'
import { useTableSort } from '@/lib/useTableSort'

const { sort, toggleSort } = useTableSort({ defaultCol: 'created_at', defaultOrder: 'desc' })

<TableHeader className="sticky top-0 bg-card z-10">
  <TableRow>
    <SortableHead col="last_name" sort={sort} onToggle={toggleSort}>Patient</SortableHead>
    <SortableHead col="last_visit" sort={sort} onToggle={toggleSort}>Last visit</SortableHead>
    <TableHead>Status</TableHead>   {/* non-sortable column */}
  </TableRow>
</TableHeader>
```

Pass `sort` into the data hook so the backend (or local sort) honors it:

```ts
const { data } = usePatients({ sort: sort?.col, order: sort?.order })
```

### Backend convention

The backend list endpoint accepts `?sort=<col>&order=asc|desc` query
params. The column name is validated server-side against a static
allow-list to prevent injection — never pass `req.query.sort` directly
to `sql.identifier()`.

```ts
// In routes.ts — map allow-list keys to Drizzle column refs in db.ts
const SORTABLE_COLUMNS = {
  last_name: patients.lastName,
  created_at: patients.createdAt,
} as const

const sortParse = z
  .object({
    sort: z.enum(Object.keys(SORTABLE_COLUMNS) as [string, ...string[]]).optional(),
    order: z.enum(['asc', 'desc']).optional(),
  })
  .safeParse(req.query)

const col =
  sortParse.success && sortParse.data.sort
    ? SORTABLE_COLUMNS[sortParse.data.sort]
    : patients.createdAt // default
const dirFn = sortParse.success && sortParse.data.order === 'asc' ? asc : desc
// ... .orderBy(dirFn(col))
```

Wired full-stack in PR #338: patients, transactions, lab-orders,
encounters, and inventory list endpoints all honour `?sort` + `?order`.
Cursor pagination is disabled when a non-default sort is requested
(top-N only); full cursor + arbitrary sort is deferred to Phase 2.

### Accessibility

`<SortableHead>` sets `aria-sort` on the `<th>` element per ARIA 1.2.
The click target is a `<button>` for keyboard focus and Enter activation.

### Known limitation — AuditPage

`AuditPage` wires `sort` / `order` into URL state but the backend
`/api/admin/audit` does not yet honour `?sort=` / `?order=`. The visual
affordance (chevron icons, `aria-sort`) and URL encoding are fully
functional; result order is unaffected until audit backend sort is wired.

---

## Pattern 30: Coming-soon stub buttons

**Goal:** Distinguish "intentional stub" (feature not built yet) from
"real disabled" (no permission / no stock / no data). Users previously
saw the same visual for all three states; the 2026 audit
(Wave 2 cross-cutting #6) counted 30+ such stubs and recommended
differentiating them.

### Primitive

`<ComingSoonButton tooltipText="…" icon={…}>label</ComingSoonButton>` —
outline variant + inline `Soon` micro-badge + `aria-disabled="true"`.
Real disabled buttons (no permission, no stock) keep using Pattern 23
(`disabled` + tooltip explaining the reason).

```tsx
import { ComingSoonButton } from '@/components/layout'
;<ComingSoonButton icon={<Download className="h-3.5 w-3.5" aria-hidden />}>
  Export CSV
</ComingSoonButton>
```

### Why `aria-disabled` not `disabled`

Per WAI-ARIA APG Button Pattern, `aria-disabled="true"` is preferable to
the HTML `disabled` attribute because screen-reader users stay able to
Tab to the element and hear its description (the tooltip). `disabled`
removes the element from the Tab sequence and strips descriptions,
leaving SR users with no signal that the action exists at all.

### When to use

- The button reservation in the layout matters (don't want it popping
  in when the feature ships)
- The feature is genuinely coming, not abandoned
- The product team has acknowledged the stub

### When NOT to use

- The action is runtime-disabled (no stock, no permission) → Pattern 23
  with the explanation in the tooltip
- The feature is abandoned / deprecated → remove the button entirely
- The button should be invisible until the feature ships → don't render

### Sources

- WAI-ARIA APG Button Pattern — https://www.w3.org/WAI/ARIA/apg/patterns/button/
- WCAG 4.1.2 (accessible name + role + state for controls)
- shadcn `<Tooltip>` + `<Button>` primitives compose naturally

---

## Pattern 31: Wide-screen (2xl) scaling ladder

**When:** automatic — the primitives own it. This pattern documents how
the UI scales up for the clinic's primary device, the **27" front-desk
Mac at 2560×1440**, so agents extend it consistently instead of
re-inventing per-page width hacks.

### The ladder

Everything below fires at Tailwind's `2xl` breakpoint (≥1536 px
viewport — the 27" display qualifies; the 1440-class laptop does not):

| Surface              | Base                             | 2xl step                       | Owner                                  |
| -------------------- | -------------------------------- | ------------------------------ | -------------------------------------- |
| AppShell content cap | `max-w-screen-2xl` (1536 px)     | `2xl:max-w-shell` (1800 px)    | `AppShell.tsx` (+ `OperatorShell.tsx`) |
| Sidebar width        | `w-56 xl:w-64`                   | `2xl:w-72`                     | `AppShell.tsx`                         |
| Page padding ladder  | `px-4 sm:px-6 xl:px-8`           | `2xl:px-10`                    | every page wrapper + `PageToolbar`     |
| Page title           | `text-xl`                        | `2xl:text-2xl`                 | `PageHeader`                           |
| KPI value            | `text-2xl`                       | `2xl:text-3xl`                 | `KpiCell`                              |
| KPI cell padding     | `p-3`                            | — (no step, see below)         | `KpiCell`                              |
| Detail rail widths   | per-preset (Pattern 6)           | one `max-w` step up per preset | `DetailSheet`                          |
| KPI strip reflow     | `auto-fit` grid (no step needed) | —                              | `KpiStrip`                             |

`max-w-shell` (1800 px) is a named token in `tailwind.config.ts` —
never write `max-w-[1800px]` inline.

**KpiCell steps its type but not its padding** (2026-07-25 density audit,
refined 2026-07-26). It used to take both `p-3 → 2xl:p-4` and
`text-2xl → 2xl:text-3xl`. The padding step is gone: the KPI band measured
137–155px, about 10% of 1440, and padding spent the wide-canvas win on air —
`KpiStrip`'s `auto-fit` already converts extra width into more COLUMNS, which
is the version of "use the space" that shows more clinic. The **type** step
stayed, because these are headline numbers read from across a front desk
rather than at reading distance, so size here is legibility, not decoration.

The distinction generalises: **when a surface has more room, spend it on more
content or on legibility — not on air.** Padding is air. See rule 3.

### Rules for new work

1. **Don't add per-page `max-w-*` or bespoke `2xl:` overrides.** Build
   with the primitives; the ladder applies itself. A page that "looks
   too narrow on the 27"" is a primitives problem — fix it once in
   `@/components/layout`, not at the call site.
2. **The canonical padding string is now four steps:**
   `px-4 sm:px-6 xl:px-8 2xl:px-10`. Copy it whole — the design-system
   gate recognizes this exact ladder.
3. **One step only, and spend room on content or legibility — never on
   air.** Each surface takes at most one increment at `2xl`; resist
   stacking `3xl`-style escalations. Do NOT add `2xl:` type steps to body
   copy or table rows — the base scale was retuned for this display
   instead (see "Reading distance", below), so `text-sm` rows stay
   `text-sm` at every width. When a surface could either
   grow its own chrome or show more rows/columns in the same chrome,
   choose the latter: on a 27" clinic display the scarce resource is
   vertical space for records, not visual weight. `KpiCell` is the
   worked example of getting this wrong and reverting it.
4. **New primitives must declare their 2xl step** (or explicitly note
   "no step needed", like `KpiStrip`) in their doc comment and in the
   table above.
5. **Verify at 2560×1440 first** (the clinic device), then sanity-check
   1280–1536 (laptop) where none of these steps fire.

### Why a ladder, not fluid scaling

Fixed steps keep table density predictable (clinical worklists are
scanned, not read), keep screenshots reproducible across the two real
device classes, and keep the Tailwind classes greppable — `vw`-based
fluid sizing defeats the design-system gates.

Canonical: `AppShell.tsx`, `components/layout/*.tsx`.

---

## Pattern 32: Sparkline (inline trend)

**When:** a KPI cell or dense table cell needs "how has this moved"
context. NOT for analytical charting — no axes, no tooltips, no
interaction.

**Use [`<Sparkline>`](../src/components/layout/Sparkline.tsx) from
`@/components/layout` — don't add a charting dependency for this.**
Pure SVG polyline with a dot on the latest point, flat-normalized to
its own min/max.

```tsx
import { Sparkline } from '@/components/layout'
;<Sparkline data={last7Days} tone="ok" label="7-day arrivals trend" />
```

- `data`: oldest → newest, ≥2 points (fewer renders nothing — absence
  should look like absence, no placeholder).
- `tone`: triage-severity stroke; same rule as KPI values — tone carries
  clinical meaning, not "line went down = red".
- Default size (64×20) fits a KPI cell; pass `width`/`height` for table
  cells.
- Most KPI call sites should reach for it via `<KpiCell trend={…}>`
  (Pattern 18) rather than placing it directly.
- Backend supplies the series (shipped 2026-06-12): `GET /api/dashboard`
  returns `trend7d { arrivals, revenue, unsettled }`, the `/api/transactions`
  stats sidecar returns `trend7d.revenue` + `revenueVsPrevDay`, and
  `/api/scheduled-orders` stats returns `administered7d`. Money series are
  numeric strings — parse at the call site.

If a surface needs real charting (axes, brushing, comparisons), that's
a future primitive with a dependency-gate conversation — don't grow
Sparkline into it.

Canonical: `KpiCell.tsx` (composition), `Sparkline.tsx` (primitive).

---

## Pattern 33: Today worklist (calm workflow-first home)

**When:** the home surface (`/today`). A branch normally has one or two nurses
and a trickle of patients, so the clinic's daily loop is grouped into two calm
work areas: **Care now** (due doses + patients in clinic), then **Follow-up**
(unsettled payments + completed encounters). This keeps the next clinical task
prominent without presenting a high-volume command centre.

Canonical: [`features/today/TodayPage.tsx`](../src/features/today/TodayPage.tsx).

Rules that keep it honest:

1. **Aggregator only.** The cockpit owns NO mutations and NO bespoke
   endpoints — it composes existing feature hooks (`useDashboard`,
   `useScheduledOrders`, `useTransactions`). Writes happen on the
   destination surface.
2. **One action per card.** Each lane card carries exactly one
   next-action button that deep-links into the owning page with the
   record pre-selected via URL state (Pattern 34) — e.g. Administer →
   `/scheduled-orders?selected=<id>&tab=overdue`, Collect →
   `/transactions?selected=<id>`.
3. **Work area first, lanes second.** Do not render four equal competing
   columns. Within each work area, lanes use severity-striped cards (`data-severity` + `stripe`,
   `rounded-lg border bg-card shadow-sm`), eyebrow lane title + mono
   count, dashed-border empty hint. Overdue sorts above due within a
   lane.
4. `/today` is the post-login default (`defaultPathForRole`) and the
   first nav item. The legacy `/dashboard` stays for stats/shift
   widgets — don't grow the cockpit into a stats page.
5. Lanes are bounded by "today" — anything not actionable today
   belongs on a worklist page, not here.
6. Counts are clinical assertions. During initial loading render an em dash and
   a loading label; never manufacture a reassuring zero. Preserve the last
   known snapshot during background refresh and label it as updating.

---

## Pattern 34: URL-as-state on worklists

**When:** every list/worklist page. Filters, tabs, and selection live in
the URL, not in throwaway `useState` — refresh-safe, back-button-sane,
and deep-linkable (the Today cockpit and topbar chips depend on it).

Three param conventions:

| Param                           | Meaning                        | Write style                                                  |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `?q=`                           | Search text                    | Debounced (250 ms), `{ replace: true }`                      |
| `?tab=` / `?status=` / `?date=` | Active filter                  | On change, `{ replace: true }`; delete param when at default |
| `?selected=`                    | Open this record's detail rail | **Consume one-shot**: set local state, then strip the param  |

The `?selected=` consume-then-strip pattern (so closing the rail doesn't
re-open on refresh/back):

```tsx
useEffect(() => {
  const sel = searchParams.get('selected')
  if (sel && sel !== selectedId) {
    setSelectedId(sel)
    const next = new URLSearchParams(searchParams)
    next.delete('selected')
    setSearchParams(next, { replace: true })
  }
}, [searchParams, selectedId, setSearchParams])
```

Canonical: `ScheduledOrdersPage.tsx` (q + tab + selected),
`TransactionsPage.tsx` (date + view + status + patient + selected).
When adding a new list page, wire the URL params from day one — don't
bolt them on later.

---

## Pattern 35: Continuous flow in the rail (no stacked dialogs)

**When:** a detail rail's primary action is a multi-stage commit
(review → administer → collect). Replaces dialog-chains stacked over
the rail.

Canonical: [`ScheduledOrderDetail.tsx`](../src/features/scheduled-orders/components/ScheduledOrderDetail.tsx).

The mechanics:

1. **Flow panels, not dialogs.** Each stage's content is a
   surface-agnostic panel component (`AdministerPanel`,
   `CollectPaymentPanel` in `scheduled-orders/components/`) that owns its
   form state, mutation, and footer buttons, and **resets by
   unmounting**. A thin `*Dialog` wrapper keeps the modal hosting for
   surfaces without a rail (Arrivals Day-0 hand-off) — sr-only
   `DialogTitle`/`DialogDescription` satisfy Radix a11y while the panel
   renders the visible heading.
2. **The rail owns a `step` state** (`'review' | 'administer' |
'collect'`) and swaps its body — review sections render only on
   `review`; the panel renders inline on its step. Reset the step when
   the selected record changes (`useEffect` on the id).
3. **A `FlowStepRail` header** (numbered mono eyebrow steps: active =
   primary, done = triage-ok, pending = muted) sits under the
   SheetHeader so the user always knows where they are.
4. **Keyboard:** the review step's ⌘↵ advances to administer; the
   administer panel binds its own ⌘↵ to commit while mounted — guard the
   rail-level listener by `step === 'review'` so they never both fire.
5. Cancel always returns to `review` (panel unmount = state reset);
   completing a stage advances (`administer` success → `collect`).
6. The administer step starts with a persistent bedside checkpoint: patient
   name + MRN + DOB, vaccine/service and dose facts, route/site, active allergy
   and condition flags, explicitly selected brand, administering clinician, and
   consent. The current nurse workflow captures **brand**, not a nurse-selected
   lot; inventory may map that choice to an eligible internal lot until
   patient-to-lot traceability becomes an implemented clinic workflow.

Why: stacked dialogs hide the order context the operator just reviewed,
and each dialog re-introduces a scrim over the rail. The flow keeps the
patient header, status badges, and step position visible through the
whole commit.

---

## Pattern 36: Table row density (`<Table density>`)

Row height belongs to the `Table` primitive, not to call sites. Two tiers:

| Tier      | Cell padding  | Header | Use for                                                        |
| --------- | ------------- | ------ | -------------------------------------------------------------- |
| `default` | `px-2 py-2`   | `h-10` | Reference + admin lists (Users, Claims, Payer profiles, …)     |
| `compact` | `px-2 py-1.5` | `h-8`  | Worklists — the daily loop (Scheduled orders, Transactions, …) |

```tsx
<Table density="compact">
  <TableHeader className="sticky top-0 bg-card z-10">…</TableHeader>
  <TableBody>{/* plain <TableCell>, no padding classes */}</TableBody>
</Table>
```

Worklists are denser on purpose (DESIGN.md §2 — they answer "how much of
today can I see at once"); reference lists trade a few rows for legibility.

**Never put `py-*` on a `TableCell`/`TableHead`.** That is what this pattern
exists to prevent: before it, 225 cell className strings carried their own
vertical padding (53× `py-3`, 36× `py-2`, 11× `py-2.5`, 14× `py-1.5`) and the
same app shipped rows from 39px to 65px, measured at 2560×1440. `px-*` column
gutters are still fine at the call site, and `colSpan` empty-state cells keep
their own deliberate whitespace.

Adding a third tier is almost always the wrong answer — if a table needs to
be shorter, the row's CONTENT is usually the height driver (a stacked
name-over-email cell is ~55px at any padding), not the padding.

Canonical: [`ScheduledOrdersPage.tsx`](../src/features/scheduled-orders/ScheduledOrdersPage.tsx)
(compact), [`UsersPage.tsx`](../src/features/admin/UsersPage.tsx) (default).

### Sticky headers depend on this primitive staying overflow-free

`Table`'s wrapper div and `TableCard` must NOT carry `overflow-*`. CSS makes
an element a scrollport for **both** axes as soon as either axis is
non-`visible`, and a scrollport becomes the containing block for
`position: sticky` descendants. Both wrappers are content-height, so they can
never scroll vertically — which is why every Pattern 20 sticky header was
silently inert until 2026-07-25 (measured: scrolling `/transactions` 134px
moved the header up 134px). Sticky now resolves against the page's real
scroller. Corner clipping uses border-radius on the last row's outer cells.

If a table is genuinely wider than the shell, give the page's scroller a
horizontal scrollbar — do not put `overflow-x-auto` back on the card.

---

## Pattern 37: Collapsible form section (`<CollapsibleCard>`)

A `<Card>` form section that starts collapsed, for optional detail on a form
whose fast path is short.

```tsx
<CollapsibleCard
  title="Guardian"
  hint="(if minor)"
  filledCount={filled.guardian}
  forceOpen={sectionHasError.guardian}
>
  {/* FormFields */}
</CollapsibleCard>
```

Where it came from: the patient intake form asks for about thirty fields, but a
nurse registering a bite walk-in needs four (name, birth date, sex, mobile). The
rest is either optional or filled in on a later visit. Identity and Contact stay
open; Guardian, Medical baseline, Coverage, and Onboarding collapse, which puts
the whole form on one screen at 1440 and well inside one screen at 2560.

Three rules, each closing a way a collapsed section becomes a trap:

- **`forceOpen` when a field inside has an error.** A form that refuses to submit
  with no visible reason is worse than a cluttered one. Pass the section's own
  `formState.errors` check; the toggle is overridden while it is true.
- **`filledCount` while collapsed.** Editing an existing patient must not hide
  their guardian behind a closed lid. A count badge ("2 filled") says there is
  something inside without opening it. Omit it, or pass 0, and no badge renders.
- **Children stay mounted**, hidden with the `hidden` attribute rather than
  unmounted, so react-hook-form keeps their state and validation still runs on a
  collapsed field.

Not Radix: `@radix-ui/react-collapsible` is not a dependency, and a disclosure
toggle is a `useState(false)` plus `aria-expanded` / `aria-controls`. The
dependency gate is not worth spending here.

Use `<FormSectionHeader>` inside a plain `<Card>` for sections that must always
be open. Do not hand-roll a details/summary or a bespoke chevron button.
