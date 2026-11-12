# Design System — Frontend Primitives

Use the layout primitives in `apps/frontend/src/components/layout/`
instead of hand-rolling list-page markup. The visual conventions are
documented in [`apps/frontend/docs/PATTERNS.md`](../../apps/frontend/docs/PATTERNS.md);
this rule covers when to reach for which primitive and what gates will
block drift.

## The seventeen primitives

| Primitive             | Pattern | Use for                                                                                                                     |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `<PageHeader>`        | 11      | Page title row — title + description + right-aligned actions                                                                |
| `<KpiStrip>`          | 10      | Ruled-divider container for top-of-page metrics                                                                             |
| `<KpiCell>`           | 18      | Single KPI inside a `<KpiStrip>` — eyebrow + value + subtitle                                                               |
| `<ListEmpty>`         | 21      | "No {entity} found" state — icon + muted message + optional `action` CTA. The app's only empty-state primitive              |
| `<DetailSheet>`       | 6       | Right-side detail rail — `narrow` / `standard` / `wide` widths                                                              |
| `<TableCard>`         | 25      | Rounded-card wrapper around a list `<Table>` or `<table>`                                                                   |
| `<PageToolbar>`       | 25      | Filter / search / tabs row beneath the page head                                                                            |
| `<FormSectionHeader>` | 26      | Eyebrow header for a multi-section `<Card>` form                                                                            |
| `<CollapsibleCard>`   | 37      | Form section that starts collapsed: optional detail on a form whose fast path is short; auto-opens on a validation error    |
| `<ErrorBanner>`       | 27      | AlertCircle + destructive-text load-failed banner in detail rail                                                            |
| `<ErrorBoundary>`     | 28      | React-class fallback wrapping `<Outlet>` + detail rails. Renders `<ErrorBanner>` + Refresh button on caught errors          |
| `<SortableHead>`      | 29      | `<TableHead>` wrapper with click-to-sort affordance + `aria-sort`, paired with `useTableSort`                               |
| `<ComingSoonButton>`  | 30      | Outline button + `Soon` badge for an intentional stub, distinct from a real disabled state                                  |
| `<NotFoundPage>`      | 28      | 404 catch-all (`<Route path="*" element={<NotFoundPage />}/>`). Keeps typo'd URLs from silently rendering the Patients list |
| `<Sparkline>`         | 32      | Inline SVG trend line for KPI/table cells — no charting dependency. Usually composed via `<KpiCell trend={…}>`              |
| `<DoseStrip>`         | 13      | **`@/components/clinical`** — connected dose-progress nodes (done/due/overdue/upcoming). The signature clinical primitive   |
| `<DetailRail>`        | 6       | Sheet root for worklist detail rails — non-modal at `2xl` (list stays interactive). Edit-form sheets keep plain `<Sheet>`   |

`DirtyFormGuard` also lives in the `layout/` barrel but isn't in this table: it's
a navigation-blocking behavior, not a visual primitive with a PATTERNS.md pattern
number. See `.claude/rules/gotchas.md`, the `DirtyFormGuard` SPA-nav-prompt section.

Import from the barrel (`@/components/clinical` has its own barrel for
clinical primitives — currently `DoseStrip`):

```tsx
import {
  PageHeader,
  KpiStrip,
  KpiCell,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
  FormSectionHeader,
  CollapsibleCard,
  ErrorBanner,
  ErrorBoundary,
  NotFoundPage,
  Sparkline,
  DetailRail,
} from '@/components/layout'
import { DoseStrip } from '@/components/clinical'
```

## Formatting + status humanizer utils

One canonical utility module (`@/lib/format`) — use it in every list cell,
badge, toast, detail rail. The previous ad-hoc pattern
(`new Date().toLocaleDateString(…)` sprinkled per-call-site, `PHP {raw}`
strings without separators) is now banned. The legacy `@/shared/lib/format`
module was deleted in the format-consolidation cutover (Wave 10, 2026-05-24).

| Util                                 | Imports from   | Output                                                                     | When to use                                                                                   |
| ------------------------------------ | -------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `formatDate(input)`                  | `@/lib/format` | Relative ≤14d ("Today" / "3 days ago"), then `MMM D, YYYY`, `—` if invalid | List cells + detail rails where humans scan ages                                              |
| `formatLongDate(input)`              | `@/lib/format` | Always `May 17, 2026`                                                      | Receipts, BIR-record fields, narrative copy, DOB, "Issued at" — anywhere relative reads wrong |
| `formatDateTime(input)`              | `@/lib/format` | ISO `2026-05-24 15:45` (24h, no seconds)                                   | Technical surfaces — audit log raw row, detail-rail "Created at" / "Updated at"               |
| `formatLongDateTime(input)`          | `@/lib/format` | Locale `May 24, 2026, 03:45 PM` (12h)                                      | Narrative copy, toast bodies, dialog descriptions                                             |
| `formatTime(input)`                  | `@/lib/format` | `03:45 PM`                                                                 | Branch banner "open since", appointment slot times, clock-in times                            |
| `formatMoney(input)`                 | `@/lib/format` | `₱4,820.00` (peso symbol, locked design call)                              | Default for every currency display surface                                                    |
| `formatNumber(input)`                | `@/lib/format` | `4,820.00` (no prefix)                                                     | When the surface labels the currency separately (rare)                                        |
| `DASH` / `nullable` / `formatScalar` | `@/lib/format` | em-dash / null-coalescing / generic dispatch                               | Niche — most call sites should use a typed formatter directly                                 |
| `humanizeStatus(raw)`                | `@/lib/status` | `awaiting_payment → Awaiting payment`, `ResultReceived → Result received`  | Status pills, badges                                                                          |

Required-asterisk convention for forms (per Wave 2 polish sweep): every Zod-required field's `<FormLabel>` renders `<span className="text-destructive"> *</span>` inline. Booleans are checkboxes and DON'T carry the marker. Drop any `(optional)` inverse markers when found.

## Shared form pickers

Wave 2 added shared picker primitives for fields that used to be free-text ID inputs:

| Picker            | Imports from         | Use for                                                                                                                                                             |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<PatientPicker>` | `@/components/forms` | Anywhere a `patientId` is required — searchable, debounced, scoped to tenant                                                                                        |
| `<BranchPicker>`  | `@/components/forms` | Anywhere a `branchId` is required — Select over branches the user can access                                                                                        |
| `<LotPicker>`     | `@/components/forms` | Anywhere a `lotId` is required — searchable, debounced, in-stock lots only (quantityOnHand > 0); rows show batchNumber · serviceName + LOT_xxx badge + expiry + QOH |

Use these instead of `<Input placeholder="PAT-...">` / `<Input placeholder="BRN-...">` / `<Input placeholder="LOT_...">`. Audited free-text-ID inputs killed in Wave 2: Book Appointment Branch ID, AEFI Patient ID, Record Payment Payer ID (the third uses a payer-profiles `<Select>` similar shape). Wave 3: ShipTransferDialog Lot ID field.

## Entity display labels

B40 (Wave 2) added a shared display primitive for user references in detail drawers:

| Primitive        | Imports from                | Use for                                                                                                                             |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `<UserLabel>`    | `@/components/UserLabel`    | Render a `createdBy` / `UserRef` object as "Full Name + `USR_…` badge". Pass `null` → renders `—`.                                  |
| `<PatientLabel>` | `@/components/PatientLabel` | Render a `PatientRef` as "Lastname, Firstname + MRN badge". Default `showMrn=true`. Pass `null` → renders `—`. Mirror of UserLabel. |

Props for `<UserLabel>`: `user: UserRef | null`, `variant?: 'default' | 'compact'`, `showCopy?: boolean`.
`UserRef` type is co-located in `apps/frontend/src/components/UserLabel.tsx`.
Replace any `createdById` raw-string display with `<UserLabel user={row.createdBy} />`.

Props for `<PatientLabel>`: `patient: PatientRef | null`, `variant?: 'default' | 'compact'`, `showMrn?: boolean` (default `true`), `showCopy?: boolean`.
`PatientRef` type is co-located in `apps/frontend/src/components/PatientLabel.tsx`.
Replace any raw `patientId`/`displayId` staff-facing display with `<PatientLabel patient={ref} showMrn />`.

## The canonical list-page shape

```tsx
<div className="h-full flex flex-col">
  <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
    <PageHeader title="…" description="…" actions={…} />
  </div>
  <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
    <KpiStrip>{/* KpiCell × 4 — layout is intrinsic, no `columns` prop */}</KpiStrip>
  </div>
  <PageToolbar>{/* search input + Tabs + chips */}</PageToolbar>
  <ScrollArea className="flex-1">
    <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
      <TableCard>
        {/* `density="compact"` on worklists, omit on reference/admin lists */}
        <Table density="compact">
          <TableHeader className="sticky top-0 bg-card z-10">…</TableHeader>
          <TableBody>
            {/* <TableRow interactive onClick={…}> for clickable rows.
                NEVER put py-* on a cell — Pattern 36 owns row height. */}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  </ScrollArea>
  <Sheet open={…}>
    <DetailSheet>{/* detail content */}</DetailSheet>
  </Sheet>
</div>
```

Page content is globally capped at `max-w-screen-2xl` (1536 px), relaxing
to `max-w-shell` (1800 px, named token in `tailwind.config.ts`) at the
`2xl` breakpoint, by the AppShell `<Outlet>` wrapper — pages don't apply
max-width themselves.

## Theme identity + wide-screen scaling (2026-06-12 revamp)

The palette is SureVax's own: clinical-teal `--primary`, faintly tinted
`--background` (cards read as layers), dark ink-teal `--sidebar-*` tokens
driving the AppShell nav rail. All hues live in
`apps/frontend/src/index.css` — see PATTERNS.md "Theme identity tokens"
for values + change protocol. Triage colors are semantic and never follow
brand changes. Sidebar token classes (`bg-sidebar`, `text-sidebar-*`,
`border-sidebar-border`, `ring-sidebar-ring`) are for the nav rail only.

Surface zones: chrome bands (header/KPI/toolbar) sit on `bg-card`; the
scroll canvas stays tinted `bg-background`; tables/cards float with
`shadow-sm` (Pattern 25). The home surface is the Today cockpit
(`/today`, Pattern 33 — aggregator lanes, one deep-link action per
card); worklists carry URL state per Pattern 34 (`?q`/`?tab`/`?status`,
one-shot `?selected=`). Multi-stage rail commits (administer → collect)
run inline as flow panels, not stacked dialogs (Pattern 35). Visual
snapshots: `VISUAL=1 pnpm test:e2e --project=visual` (2560×1440,
local-only).

Wide-screen scaling is a fixed ladder at the `2xl` breakpoint (the 27"
2560×1440 front-desk Mac), owned by the primitives — PATTERNS.md
Pattern 31. The canonical page padding is now four steps:
`px-4 sm:px-6 xl:px-8 2xl:px-10`. Don't add per-page `max-w-*` or bespoke
`2xl:` overrides; if a page looks wrong at 2560, fix the primitive.

## What's enforced

| Layer                                                                           | What it catches                                                                                                                                      |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`scripts/check-tailwind-tokens.sh`](../../scripts/check-tailwind-tokens.sh)    | `text-[Npx]` arbitrary text sizes (use scale tokens)                                                                                                 |
| [`scripts/check-design-system.sh`](../../scripts/check-design-system.sh)        | Hand-rolled SheetContent, h1 titles, `<Card><CardContent p-0><Table>`, `border rounded-md` tables, inline empty-state icons, inline toolbar `<div>`s |
| ESLint `no-restricted-syntax` in [`eslint.config.mjs`](../../eslint.config.mjs) | `<SheetContent side="right">` and `<h1 className="text-lg font-semibold">` (precise AST)                                                             |

All three run in CI's `Install, typecheck, build` job. The PreToolUse
hook `.claude/hooks/pr-format-gate.sh` runs `prettier --check .` and
`pnpm lint` before `gh pr create`, so the ESLint rules fire locally
too.

## Required-field markers

RHF forms mark required inputs with a destructive-color asterisk inline
inside the `<FormLabel>`, after the label text:

```tsx
<FormLabel>
  Name <span className="text-destructive">*</span>
</FormLabel>
```

A field is "required" when its Zod schema entry is not `.optional()`
and not a boolean (booleans are checkboxes — they don't carry a
required marker). Optional fields render their label plain. There is
no `<FormMessage>` styling override — keep the shadcn default.

## Allow-list policy

The CI script and ESLint config maintain parallel allowlists for
documented exceptions:

- `PatientList.tsx` — dense list-and-detail layout with custom button
  sizing that `PageHeader` doesn't accommodate
- `TransactionsCreatePage.tsx` — cashier flow whose h1 wraps a dynamic
  patient name
- `BiteAssessmentDemo.tsx` — demo surface, not a routed page
- `AdverseEventsPage.tsx` — empty state inside `<TableRow>` (Pattern 21
  anti-pattern); restructuring out of scope
- `TransactionsPage.tsx` — empty state has interactive sub-hint button
- `DaySummaryPage.tsx` — local `EmptyState` helper with dense `py-8`,
  5 callers
- `AppShell.tsx` — mobile-nav `<SheetContent side="left">` (not a
  detail rail)

If you're adding a new exception, update **both** allowlists (keep
them in sync) and add a `# why` comment explaining the call.

## When the gates fire

- **Adding a new list page** — use the canonical shape above. The
  gates won't fire because every required primitive is in `@/components/layout`.
- **You see "Use `<X>` instead"** — the message points at the
  canonical primitive and the PATTERNS.md section to consult.
- **You genuinely need an exception** — add a one-line `# why` comment
  next to the path in both allowlists. Don't bypass the rule silently.

## Dialog title + a11y conventions (Wave 6, 2026-05-24)

All `<DialogTitle>` and `<AlertDialogTitle>` strings use **sentence case** — capitalise only
the first word and proper nouns/acronyms (BIR, PIN, FEFO, PDF, ESC/POS, FAT, Rx).

| Before (Title Case)       | After (sentence case)  |
| ------------------------- | ---------------------- |
| "Report Adverse Event"    | "Report adverse event" |
| "Ship Inventory Transfer" | "Send transfer"        |
| "Capture Bite Incident"   | "Record bite incident" |
| "New Service"             | "New service"          |
| "Edit Template"           | "Edit template"        |

Every `<Dialog>` must include a `<DialogDescription>` sibling to `<DialogTitle>` for
Radix/Aria accessible naming. Without it, screen readers announce no context for the
dialog role. One sentence describing what the dialog does is sufficient.

Cancel-button labels: the dismiss button in a form dialog must read `Cancel`, not
`"Not now"`, `"Close"`, or `"Go back"`. The sole exception is a post-action
completion state where the dialog closes read-only — use `Close` there (e.g.
AdministerDialog after a successful administer).

## Adding a new primitive

When a new layout pattern emerges:

1. Build the primitive in `apps/frontend/src/components/layout/<Name>.tsx`
2. Export from `apps/frontend/src/components/layout/index.ts`
3. Document the pattern in `apps/frontend/docs/PATTERNS.md` (next number)
4. If old hand-rolled markup needs to die, add a rule to
   `scripts/check-design-system.sh` and/or `eslint.config.mjs`
5. Codemod existing call sites; verify the gate is clean before merging
6. Reference the primitive in `apps/frontend/CLAUDE.md` under
   "Patterns specific to clinical workflow"

The primitive owns the canonical markup. The gates own the discipline
that keeps drift from re-introducing it.
