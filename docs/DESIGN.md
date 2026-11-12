# DESIGN.md — SureVax CMS Design System

Clinical-grade UI built on top of shadcn/ui + Tailwind. This document
describes the full design language: tokens, typography, spacing,
components, and clinical conventions.

**Related docs:**

- [`apps/frontend/docs/PATTERNS.md`](../apps/frontend/docs/PATTERNS.md) — pattern recipes with code
- [`apps/frontend/docs/COMPONENT-MAP.md`](../apps/frontend/docs/COMPONENT-MAP.md) — clinical concept → primitive
- [`apps/frontend/CLAUDE.md`](../apps/frontend/CLAUDE.md) — building rules for AI/contributors

---

## 1. Design Principles

1. **Severity is the primary affordance.** Every actionable item signals
   urgency via color + spatial treatment (badge + stripe). Users should
   be able to scan a list and act without reading every cell.

2. **Worklist over CRUD.** Landing pages answer "what needs me now?" —
   sorted by severity, grouped in lanes (`Overdue → Due → Upcoming`).
   Plain "show everything" tables are not acceptable as primary views.

3. **Tokens over raw values.** All colors come from CSS variables in
   `index.css`. Never write hex, oklch, or RGB in a component class.

4. **Extend, don't fork.** New Button look → add a variant to
   `button.tsx`. New Badge meaning → add a variant to `badge.tsx`. No
   `BrandButton.tsx`, `ClinicalBadge.tsx`, etc.

5. **Mono for facts.** IDs, times, money, doses — `font-mono
tabular-nums`. Vertical alignment matters in clinical lists.

6. **Sheet for detail, Dialog for confirmation.** Record detail always
   opens in a right `<Sheet>` so the list stays visible. Destructive /
   irreversible operations use `<AlertDialog>`.

---

## 2. Color System

### 2.1 Semantic tokens (CSS variables in `src/index.css`)

These are the only colors any component should reference.

2026-06-12 identity revamp: clinical-teal primary on a faintly tinted
canvas (cards read as layers). `src/index.css` is the source of truth;
this table mirrors it.

| Token                      | HSL value     | Role                                   |
| -------------------------- | ------------- | -------------------------------------- |
| `--background`             | `200 27% 98%` | Page canvas (1 step off-white)         |
| `--foreground`             | `203 45% 10%` | Body text (teal-ink)                   |
| `--card`                   | `0 0% 100%`   | Card / surface (white, pops vs canvas) |
| `--card-foreground`        | `203 45% 10%` | Text on card                           |
| `--popover`                | `0 0% 100%`   | Dropdown / popover surface             |
| `--popover-foreground`     | `203 45% 10%` | Text in popover                        |
| `--primary`                | `174 65% 27%` | Clinical teal — buttons, links         |
| `--primary-foreground`     | `168 75% 97%` | Text on primary                        |
| `--secondary`              | `190 25% 94%` | Subtle surfaces                        |
| `--secondary-foreground`   | `203 40% 15%` | Text on secondary                      |
| `--muted`                  | `200 22% 95%` | Disabled / inactive                    |
| `--muted-foreground`       | `203 13% 41%` | Secondary text, hints                  |
| `--accent`                 | `174 35% 93%` | Hover state background (teal wash)     |
| `--accent-foreground`      | `175 60% 16%` | Text on accent                         |
| `--destructive`            | `0 74% 50%`   | Error, void, refund                    |
| `--destructive-foreground` | `0 0% 98%`    | Text on destructive                    |
| `--border`                 | `200 22% 89%` | Default border                         |
| `--input`                  | `200 22% 86%` | Input border                           |
| `--ring`                   | `174 65% 32%` | Focus ring                             |
| `--radius`                 | `0.5rem`      | Base corner radius                     |

**Tailwind usage:** `bg-background`, `text-foreground`, `border-border`,
`ring-ring`, etc. — one class per token.

### 2.2 Clinical severity tokens

Purpose-built for triage states. **Not** interchangeable with brand
colors. Use when the meaning is severity, not brand identity.

| Token pair | Foreground HSL             | Soft background HSL         | Use                         |
| ---------- | -------------------------- | --------------------------- | --------------------------- |
| `overdue`  | `12 75% 44%` (dark red)    | `12 78% 95%` (light red)    | Past due, critical, blocked |
| `due`      | `38 80% 52%` (amber)       | `42 80% 95%` (light amber)  | Due today / this week       |
| `ok`       | `148 50% 38%` (green)      | `148 40% 95%` (light green) | Completed, settled, healthy |
| `info`     | `220 50% 45%` (steel blue) | `220 35% 95%` (light blue)  | Informational, scheduled    |

**Tailwind classes:**

```
text-triage-overdue   bg-triage-overdue-soft   border-triage-overdue/35
text-triage-due       bg-triage-due-soft       border-triage-due/40
text-triage-ok        bg-triage-ok-soft        border-triage-ok/35
text-triage-info      bg-triage-info-soft      border-triage-info/35
```

Never use color words ("red", "green") in user-facing copy. Use the
action ("Overdue", "Completed", "Settled").

### 2.3 Sidebar tokens

The sidebar uses an inverted dark ink-teal palette regardless of page
theme. These tokens drive the AppShell nav rail (PATTERNS.md
Pattern 19) and are never used on content surfaces.

| Token                  | Value                             |
| ---------------------- | --------------------------------- |
| `--sidebar-background` | `201 45% 10%` (ink teal-navy)     |
| `--sidebar-foreground` | `186 25% 92%` (near-white)        |
| `--sidebar-primary`    | `172 52% 44%` (teal accent)       |
| `--sidebar-accent`     | `199 38% 16%` (hover/active dark) |
| `--sidebar-border`     | `199 38% 16%`                     |
| `--sidebar-ring`       | `172 52% 44%` (focus inside rail) |

### 2.4 Brand tokens (direct hex) — removed

The `brand.*` hex palette was removed from `tailwind.config.ts` in the
2026-06-12 revamp (it was unused). Charting/illustration colors should
derive from the semantic tokens above; if a chart genuinely needs its
own palette, add `--chart-N` CSS variables to `index.css` (the Tailwind
`chart.*` token mapping already exists).

---

## 3. Typography

### 3.1 Font stack

Body font: **Inter Variable** (self-hosted via
`@fontsource-variable/inter`, imported in `main.tsx`), with system
fallback `ui-sans-serif, system-ui, sans-serif`. OpenType features
`cv02, cv03, cv04, cv11` are enabled for improved legibility (alternate
digits, disambiguation glyphs).

Monospace: **JetBrains Mono Variable** (self-hosted via
`@fontsource-variable/jetbrains-mono`, imported in `main.tsx`), falling
back to the stock Tailwind stack — `ui-monospace, SFMono-Regular,
Menlo, Monaco, Consolas`. Mono carries "facts" (IDs, money, doses,
times) per PATTERNS.md Pattern 8 + "Typography identity".

### 3.2 Type scale

| Class                     | Size     | Weight                             | Use |
| ------------------------- | -------- | ---------------------------------- | --- |
| `text-2xl font-bold`      | 24px/700 | Page brand (login)                 |
| `text-xl font-semibold`   | 20px/600 | Page `<h1>`                        |
| `text-lg font-semibold`   | 18px/600 | Section `<h2>`                     |
| `text-base font-semibold` | 16px/600 | Subsection `<h3>`, card titles     |
| `text-sm font-medium`     | 15px/500 | Labels, row headings               |
| `text-sm`                 | 15px/400 | Body text, table cells             |
| `text-xs font-medium`     | 13px/500 | Badge text                         |
| `text-xs`                 | 13px/400 | Metadata, secondary info           |
| `.eyebrow`                | 11px/600 | Section eyebrow labels (see below) |

All `h1`–`h6` inherit `tracking-tight` from the base layer.

### 3.3 Utility classes

**`.eyebrow`** — uppercase mono section label, typically placed above
`<h2>` or above a card heading to give spatial context without visual
weight.

```tsx
<span className="eyebrow">On commit · single transaction</span>
<CardTitle>4 things happen together</CardTitle>
```

CSS: `font-mono 10px font-semibold uppercase tracking-wide
text-muted-foreground`.

**`font-mono tabular-nums`** — apply to any numericdata that must align
vertically across rows: IDs, times, dates in shorthand, money (₱),
doses, lot codes, counts in dense tables.

```tsx
<span className="font-mono tabular-nums text-sm">₱4,820.00</span>
<span className="font-mono tabular-nums text-xs text-muted-foreground">PAT-K9MX3VQ2P5</span>
```

---

## 4. Spacing

No custom spacing scale — uses the Tailwind default (4px base). Common
applied values:

| Context                       | Classes                                |
| ----------------------------- | -------------------------------------- |
| Page header padding           | `px-6 py-4`                            |
| List row padding              | `px-4 py-3`                            |
| Form field spacing (vertical) | `space-y-2`                            |
| Form section spacing          | `space-y-5`                            |
| Card content grid             | `gap-3` (widgets) · `gap-4` (sections) |
| Sidebar nav item              | `px-3 py-2`                            |
| Detail sheet width            | `w-[380px]`                            |
| Badge padding                 | `px-2.5 py-0.5`                        |

---

## 5. Shape

**Border radius:** One variable, three scales.

```
--radius: 0.5rem        → rounded-lg  (8px)
calc(--radius - 2px)    → rounded-md  (6px)
calc(--radius - 4px)    → rounded-sm  (4px)
```

Shadcn primitives use these automatically. `rounded-full` for avatars
and severity dots.

**Severity stripe:** A 3px inset box-shadow on the left edge of
actionable rows. Applied via `box-shadow: inset 3px 0 0 0 hsl(--triage-*)`.

```tsx
// In component:
<TableRow data-severity="overdue" className="stripe">
```

Defined in `src/index.css` as `[data-severity='*'].stripe` selectors.

**Severity dot:** 6px circle (`width: 6px height: 6px rounded-full`).

```tsx
<span className="dot" data-severity="due" />
```

---

## 6. Elevation

shadcn/ui default shadows only. No custom `drop-shadow` or `shadow-*`
classes beyond:

| Surface            | Shadow                               |
| ------------------ | ------------------------------------ |
| `Card`             | `shadow-sm` (default via `card.tsx`) |
| Login card         | `shadow-sm`                          |
| `Sheet` / `Dialog` | System overlay shadow (Radix portal) |
| Sidebar            | No shadow — uses border              |

No decorative gradients.

---

## 7. Component Library

### 7.1 Shadcn/ui primitives (installed)

All live in `apps/frontend/src/components/ui/`.

| File                | Component(s)                                                                              | Key variants / notes                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `alert.tsx`         | `Alert`, `AlertTitle`, `AlertDescription`                                                 | `default` · `destructive`                                                                      |
| `alert-dialog.tsx`  | `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`                                   | For destructive confirms (void, refund)                                                        |
| `avatar.tsx`        | `Avatar`, `AvatarImage`, `AvatarFallback`                                                 | 2-letter initials fallback                                                                     |
| `badge.tsx`         | `Badge`                                                                                   | `default · secondary · destructive · outline · overdue · due · ok · info`                      |
| `button.tsx`        | `Button`                                                                                  | `default · destructive · outline · secondary · ghost · link`; sizes `default · sm · lg · icon` |
| `card.tsx`          | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`         |                                                                                                |
| `checkbox.tsx`      | `Checkbox`                                                                                | Row selection, boolean form flags                                                              |
| `command.tsx`       | `Command`, `CommandDialog`, `CommandInput`, etc.                                          | Used for combobox autocomplete                                                                 |
| `dialog.tsx`        | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`             | Modals only — not for record detail                                                            |
| `dropdown-menu.tsx` | `DropdownMenu`, `DropdownMenuTrigger`, etc.                                               | User menu, context actions                                                                     |
| `empty-state.tsx`   | `EmptyState` _(custom)_                                                                   | Icon + headline + description + action                                                         |
| `form-section.tsx`  | `FormSection` _(custom)_                                                                  | Groups form fields under a heading                                                             |
| `form.tsx`          | `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`                | RHF integration                                                                                |
| `input.tsx`         | `Input`                                                                                   | Standard; add `font-mono tabular-nums` for numeric                                             |
| `label.tsx`         | `Label`                                                                                   | Always paired with inputs for accessibility                                                    |
| `resizable.tsx`     | `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`                                | Two-panel layouts (patients, encounters)                                                       |
| `scroll-area.tsx`   | `ScrollArea`                                                                              | Wraps long lists inside fixed-height containers                                                |
| `select.tsx`        | `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`                                  | Single-value picker                                                                            |
| `separator.tsx`     | `Separator`                                                                               | Horizontal/vertical dividers                                                                   |
| `sheet.tsx`         | `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetTrigger`                      | `side="right"` for all detail panels                                                           |
| `skeleton.tsx`      | `Skeleton`                                                                                | Loading placeholders — match the target layout exactly                                         |
| `table.tsx`         | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableCaption` |                                                                                                |
| `tabs.tsx`          | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                                          | Severity filters, role filters, payment methods                                                |
| `textarea.tsx`      | `Textarea`                                                                                |                                                                                                |
| `toast.tsx`         | Toast primitives (via Sonner)                                                             | Commit toasts: title + mono ID                                                                 |
| `tooltip.tsx`       | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`                          | Hover help; required wrapper for disabled-stub CTAs (Pattern 23)                               |

### 7.2 Custom components

| File                             | Purpose                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/empty-state.tsx`  | Richer empty state (icon-in-circle + headline + description + action). Reserved for "first-time setup" / "no data ever" cases with a clear CTA. Worklist filter-misses use the inline pattern in section 11 instead — currently 0 imports across the app, so prefer the inline pattern unless you specifically need the CTA slot. |
| `components/ui/form-section.tsx` | Titled group of form fields — used in multi-section forms to reduce `<h3>` repetition                                                                                                                                                                                                                                             |
| `shared/components/AppShell.tsx` | Full-page layout: dark sidebar + top bar + content outlet; handles mobile drawer, user menu, clock-in banner                                                                                                                                                                                                                      |

### 7.3 Badge clinical variants

The four clinical variants live in the same `cva` block as stock
shadcn variants — not in a separate file:

```tsx
// src/components/ui/badge.tsx
overdue: 'border-triage-overdue/35 bg-triage-overdue-soft text-triage-overdue',
due:     'border-triage-due/40    bg-triage-due-soft    text-triage-due',
ok:      'border-triage-ok/35     bg-triage-ok-soft     text-triage-ok',
info:    'border-triage-info/35   bg-triage-info-soft   text-triage-info',
```

To add a new variant: edit `badge.tsx` in place, not a new file.

---

## 8. Layout System

### 8.1 AppShell

Wraps every authenticated page. Structure:

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (48px collapsed · 192px expanded)          │
│  Dark theme (bg-sidebar · text-sidebar-foreground)  │  ← desktop: fixed left
│  Nav items · User menu · Shift badge                │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│  Top bar (h-12)  breadcrumbs  mobile ☰              │
├─────────────────────────────────────────────────────┤
│  <Outlet />  (flex-1, overflow-hidden)              │
│                                                     │
│  ┌─ ClockInBanner (conditional) ──────────────────┐ │
│  │  Shown when shift is open                      │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

Mobile: sidebar becomes a left-anchored Sheet drawer, closes on
navigation.

### 8.2 Two-panel resizable (patients, encounters)

```
┌─────────────────────┬────────────────────────────────┐
│  List panel         │  Detail panel                  │
│  (30%–50%)          │  (50%–70%)                     │
│                     │                                │
│  Search · New btn   │  <Sheet> or <EmptyState>       │
│  ScrollArea         │  (record detail or "Select…")  │
└─────────────────────┴────────────────────────────────┘
```

Left is `ResizablePanel defaultSize={35}`, right is
`ResizablePanel defaultSize={65}`.

### 8.3 Worklist (scheduled orders, arrivals, inventory)

```
Page header  ──────────────────────────  New · Actions
─────────────────────────────────────────────────────
Tabs  [ All (42) ]  [ Overdue (8) ]  [ Due (15) ]  [ Upcoming ]
─────────────────────────────────────────────────────
Search ─────────────────────────────  Bulk SMS · Filter
─────────────────────────────────────────────────────
• OVERDUE ──────────────────────────────────── (8)
  ┌─────────────────────────────────────────────────┐
  │  stripe TableRow × N                           │
  └─────────────────────────────────────────────────┘
• DUE TODAY ─────────────────────────────────── (15)
  ┌─────────────────────────────────────────────────┐
  │  stripe TableRow × N                           │
  └─────────────────────────────────────────────────┘
```

Lane header: `<section>` with sticky row containing severity dot +
title + count badge + optional bulk action.

**Sticky table column headers**: every worklist applies
`sticky top-0 bg-card z-10` to its `<TableHeader>` (or `<thead>`, or
grid header div). The sticky element must sit at the top of a scroll
container (`<ScrollArea>` or `overflow-y-auto`), not the page root —
sticky is relative to the nearest scrolling ancestor. `bg-card` keeps
it opaque over scrolling rows; `z-10` keeps it above row hover state.
See PATTERNS.md #20.

### 8.4 Multi-step wizard (arrivals)

```
┌────────────┬────────────────────────────┬─────────────┐
│ Step rail  │  Active step form          │ On-commit   │
│ (left)     │  (center, scrollable)      │ summary     │
│            │                            │ (right)     │
│ 1 ✓ Done   │  Step 3: Vaccination Rx    │ 4 effects   │
│ 2 ✓ Done   │                            │ listed      │
│ 3 → Active │  <Form>                    │             │
│ 4 🔒 Locked│  ...                       │             │
└────────────┴────────────────────────────┴─────────────┘
```

Steps are gates — no forward jumps. Step rail uses
`data-state="done|current|locked"` for visual state.

**Sticky orientation**: the step rail and the primary CTA must both
remain visible regardless of scroll position. Pin the rail to the top
of the scroll body (`sticky top-0 z-10 bg-background`) and lift the
primary CTA out of the scroll into a sticky `<footer>` sibling. For
narrow flows (single-column) use a bottom footer; for wide flows
(`/transactions/new`) use a sticky right rail. See PATTERNS.md #22.

A "Selected: {chosen-template} [Change]" chip below the rail is a
useful affordance for any wizard whose first step is a picker —
keeps the user's selection visible after they scroll into step 2.

### 8.5 Centered auth

Full-viewport center (flexbox). Card `max-w-sm`, `rounded-xl shadow-sm`.
Logo + form + submit button + footer text.

### 8.6 Cashier flow

```
┌─────────────────────────────────────────────────────┐
│  Patient picker  ·  Encounter picker  ·  Discount   │
├─────────────────────────────────────────────────────┤
│  Cart (Table)            ┊  Tender rail (Sheet/     │
│  + Add service           ┊  right, 380px)           │
│  ─────────────────────── ┊  Tabs: Cash/Card/GCash   │
│  Subtotal / VAT / Disc.  ┊  Amount input (mono)     │
│  Total                   ┊  Quick-add buttons       │
│                          ┊  Change (computed)       │
├─────────────────────────────────────────────────────┤
│  Atomic commit block (Card)                         │
│  Eyebrow → Title → Numbered effects → Commit btn    │
└─────────────────────────────────────────────────────┘
```

---

## 9. Clinical Patterns

Full recipes with code in [`apps/frontend/docs/PATTERNS.md`](../apps/frontend/docs/PATTERNS.md).
Summary:

| #   | Pattern                              | When                                                                      |
| --- | ------------------------------------ | ------------------------------------------------------------------------- |
| 1   | **Severity stripe + triage badge**   | Any list row representing work                                            |
| 2   | **Worklist landing page**            | Any primary list route                                                    |
| 3   | **Atomic-commit block**              | Any action writing >1 record                                              |
| 4   | **Payment-gates-clinical**           | Clinical action requiring settled payment                                 |
| 5   | **Multi-step wizard (StepRail)**     | ≥3 dependent steps, single atomic write                                   |
| 6   | **Detail rail (Sheet, not Dialog)**  | Clicking a row in any list                                                |
| 7   | **Command palette (⌘K)**             | Global navigation + today's priorities                                    |
| 8   | **Mono for facts**                   | IDs, times, money, doses                                                  |
| 9   | **Eyebrow labels**                   | Section sub-labels above headings                                         |
| 10  | **KPI strip — ruled, not card-soup** | Top-of-page metrics                                                       |
| 11  | **Page head**                        | Top of every route — h1 + subtitle + actions row, secondary→primary order |
| 12  | **Roster table (Dashboard)**         | Today's arrivals on Dashboard                                             |
| 13  | **Dose strip (PEP visualization)**   | PEP completion progress — segmented bar with triage colors                |
| 14  | **Receipt preview**                  | Cashier flow receipt block — mono `<pre>` inside Card                     |
| 15  | **Cold-chain unit cards**            | `/cold-chain` fridges — Card grid with mono temp + status badge           |
| 16  | **Shift menu dropdown**              | Page-head shift actions (Print EOD, Close drawer, End shift)              |
| 17  | **Patient detail tabs**              | Inside Patient Sheet — horizontal `<button>` row with bottom border       |
| 18  | **KPI cell anatomy**                 | Three-layer cell: eyebrow + 2xl mono value + subtitle                     |
| 19  | **AppShell sidebar**                 | Light-bg nav with group labels + inset-shadow active indicator            |
| 20  | **Sticky table column headers**      | Every worklist table — `sticky top-0 bg-card z-10` on TableHeader/thead   |
| 21  | **Empty state (canonical)**          | List/table renders zero rows — inline div + h-8 muted icon + "No X found" |
| 22  | **Sticky save footer**               | One-page form/wizard whose content scrolls — header / body / footer split |
| 23  | **Disabled stub with tooltip**       | CTA exists but not yet wired up — `<Tooltip>` over `<span>` over disabled |

---

## 10. Form System

All forms use React Hook Form + Zod (from `@surevax/shared` on frontend;
inline in backend modules — see `gotchas.md`).

### Structure

```tsx
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
    <FormSection title="Patient Identity">
      <FormField
        control={form.control}
        name="firstName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>First name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage /> {/* zod error, red, text-sm */}
          </FormItem>
        )}
      />
    </FormSection>
  </form>
</Form>
```

### Field spacing

- Between fields within a section: `space-y-2`
- Between `<FormSection>` groups: `space-y-5`

### Numeric inputs

```tsx
<Input {...field} inputMode="decimal" className="font-mono tabular-nums text-right" />
```

`inputMode="decimal"` opens the numeric keyboard on mobile without
locking to integers. `text-right` aligns money column-like.

### Validation feedback

`<FormMessage />` renders below the input in `text-sm text-destructive`.
Never show inline alerts for single-field errors — `FormMessage` is
sufficient. Use `<Alert variant="destructive">` only for server-level
errors (auth failures, conflict errors) that span the whole form.

### Toggle selectors

Discount type (Senior/PWD), payment method, filter pills — use
`<Button variant="outline">` with `data-state="on"` for the active
state. Not radio buttons. Not a Select.

### Sticky save footer (one-page forms)

Any form whose body can scroll past the viewport must lift its
primary CTA out of the scrolling region into a sticky footer.
The save button never disappears mid-edit.

```tsx
<div className="h-full flex flex-col">
  <div className="px-6 py-4 border-b shrink-0">{/* header + Discard */}</div>

  <ScrollArea className="flex-1">
    <div className="px-6 py-5 space-y-4 max-w-5xl">{/* form content */}</div>
  </ScrollArea>

  <footer className="border-t border-border bg-card px-6 py-3 flex items-center justify-end gap-2 shrink-0">
    <Button variant="ghost">Discard</Button>
    <Button type="submit">Save changes</Button>
  </footer>
</div>
```

Same pattern inside a `<Sheet>` edit mode — make `<SheetContent>`
`flex flex-col` and place the footer as a sibling of the scroll body.
See PATTERNS.md #22.

Canonical: `features/settings/SettingsPage.tsx`,
`features/standing-orders/InitiateProtocolPage.tsx`. The cashier flow
(`features/transactions/TransactionsCreatePage.tsx`) uses a sticky
right-rail variant — appropriate for wide-desktop tender flows.

---

## 11. Loading & Empty States

### Skeleton loading

Match the target row layout exactly so the transition to loaded content
is smooth. Two canonical variants:

**Plain rows** (most worklists — used by `services`, `lab-orders`,
`adverse-events`, etc.):

```tsx
{
  Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
}
```

Wrap in `<div className="px-6 py-3 space-y-3">`. Use 5–8 rows.

**Rich rows** (when the row layout has avatar + multiline content,
e.g. patient list):

```tsx
<div className="flex items-center gap-3 px-4 py-3">
  <Skeleton className="h-8 w-8 rounded-full" /> {/* avatar */}
  <div className="flex-1 space-y-1.5">
    <Skeleton className="h-4 w-40" /> {/* name */}
    <Skeleton className="h-3 w-24" /> {/* metadata */}
  </div>
</div>
```

Don't show a spinner — it implies the exact skeleton can't be known.

### Empty state

Canonical inline pattern, used across every list page (services,
lab-orders, adverse-events, appointments, all admin/\*Page.tsx, etc.):

```tsx
<div className="px-6 py-12 text-center">
  <{Icon} className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
  <p className="text-sm text-muted-foreground">No {entity} found.</p>
</div>
```

Pick `{Icon}` from lucide-react semantically (`Stethoscope` for
encounters, `Receipt` for transactions, `Users` for users, `Bell` for
notifications, etc.). Copy is `"No {plural-entity} found."` unless
the page has different intent (e.g. `transactions/new` shows
`"Search for a patient to load encounter context"` — that's an
**unselected** state, not empty data).

Don't render empty states inside the table body
(`<TableRow><TableCell colSpan={N}>`) — render them above/instead-of
the table when data is empty so the icon centers properly.

The richer `<EmptyState>` component (`components/ui/empty-state.tsx`)
is available for "first-time setup" / "no data ever" cases that
benefit from a CTA slot. As of 2026-05-07 it has 0 imports across the
app — prefer the inline pattern unless you specifically need the CTA
button.

See PATTERNS.md #21.

### Error state

```tsx
<p className="text-sm text-destructive">
  Failed to load patients. <button onClick={refetch}>Try again</button>
</p>
```

For full-page data failures, use `<Alert variant="destructive">`.

---

## 12. Motion & Animation

Only Radix portal transitions (entrance/exit for Sheet, Dialog,
Dropdown) and accordion expand/collapse (via `tailwindcss-animate`).

```
accordion-down: 0.2s ease-out
accordion-up:   0.2s ease-out
```

No decorative transitions. No `transition-all`. Component-level
transitions are allowed on `opacity`, `transform`, and `visibility`
for interactive states (hover chevron reveal, collapsed sidebar).

---

## 13. Accessibility

- **Focus ring:** `ring-2 ring-ring ring-offset-2 ring-offset-background`
  applied globally to `:focus-visible` in base styles. Do not override
  this on interactive elements — all shadcn primitives inherit it.
- **Font smoothing:** `-webkit-font-smoothing: antialiased` on `html`.
- **Keyboard navigation:** Patient/encounter lists support arrow key
  traversal (`ArrowUp`, `ArrowDown`, `Enter`) + `/` to focus search.
- **Semantic HTML:** `<table>` for tabular data, `<ol>` for ordered
  sequences (protocol timelines, wizard steps), `<nav>` for sidebar,
  `<section>` for worklist lanes.
- **Color alone never conveys meaning:** every severity color is paired
  with a text label (`<Badge>`) or icon. Stripe + badge together — not
  one in isolation.
- **`role="status"`:** `EmptyState` and loading state containers carry
  this role for screen reader updates.

---

## 14. Do's and Don'ts

| Don't                                           | Do                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Inline hex / oklch / RGB in components          | Use a CSS token class (`text-triage-overdue`)                    |
| Color a row background to mean "urgent"         | `stripe` class + `data-severity` attribute                       |
| `Dialog` for a record detail                    | `<Sheet side="right">`                                           |
| 5 separate Cards as a KPI grid                  | One `Card` with `grid divide-x`                                  |
| `BrandButton.tsx` / `ClinicalBadge.tsx`         | Extend `button.tsx` / `badge.tsx` cva                            |
| Color words in copy ("the red rows")            | Meaning words ("the overdue ones")                               |
| Emojis in UI chrome                             | Icons from Lucide only                                           |
| Decorative gradients / outer shadows            | None beyond shadcn defaults                                      |
| `localStorage`/`sessionStorage` for auth tokens | HTTP-Only cookies (handled server-side)                          |
| `console.log` in production paths               | Pino logger via `apps/backend/src/shared/utils/logger.ts`        |
| `any` in TypeScript                             | Explicit types; inline cast if necessary (see `req.user` gotcha) |
| `font-bold` on body text                        | `font-medium` (labels) or `font-semibold` (headings)             |
| Numeric inputs without `tabular-nums`           | `font-mono tabular-nums` on every money/ID/date cell             |
| Long table without sticky `<thead>`             | `sticky top-0 bg-card z-10` on TableHeader/thead (Pattern 20)    |
| Empty state inside `<TableRow><TableCell>`      | Render the inline empty state above the table (Pattern 21)       |
| Primary Save button inside a scrolling form     | Lift it to a sticky `<footer>` outside the scroll body (#22)     |
| Silent disabled stub button                     | Wrap in `<Tooltip>` over `<span tabIndex={0}>` (Pattern 23)      |
| Primary CTA leftmost in the page head           | Secondary actions left, primary CTA rightmost (Pattern 11)       |
| Page-head buttons of mixed sizes / icon sizes   | All `size="sm"` with `h-3.5 w-3.5 mr-1.5` icons                  |
| Detail Sheet at 380 px                          | Use 420 px (`className="w-[420px] p-0"`)                         |
| Form fields without `<FormSection>`             | Group with `<FormSection title=...>` to reduce `<h3>` repetition |

---

## 15. Adding to the Design System

### New color semantic

1. Add the CSS variable to `src/index.css` `:root`.
2. Expose it in `tailwind.config.ts` under `theme.extend.colors`.
3. Document it in **section 2** of this file.

### New component variant

Edit the existing `cva` block in the relevant primitive (e.g.
`badge.tsx`). Document usage in section 7. If the primitive doesn't
exist yet, install via `pnpm dlx shadcn@latest add <name>` (or
manually — see `apps/frontend/CLAUDE.md` Shadcn CLI gotcha).

### New layout pattern

Add the ASCII layout sketch to **section 8**, point to the canonical
implementation, and add an entry to
[`apps/frontend/docs/PATTERNS.md`](../apps/frontend/docs/PATTERNS.md).

### New clinical concept

Add a row to
[`apps/frontend/docs/COMPONENT-MAP.md`](../apps/frontend/docs/COMPONENT-MAP.md).
