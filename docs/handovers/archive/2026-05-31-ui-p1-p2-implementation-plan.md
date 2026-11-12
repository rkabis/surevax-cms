# UI P1 + P2 — File-Level Implementation Plan (2026-05-31)

> **ARCHIVED 2026-06-03 — fully implemented.** P1 landed in commit `6f3c091`
> and P2 in `865bcf5` (both 2026-06-01); all acceptance criteria met. Kept for
> historical reference. The live form-surface backlog (P4/P5) is tracked in
> [`../2026-05-31-ui-form-surface-redesign.md`](2026-05-31-ui-form-surface-redesign.md).

Synthesis of two candidate designs. Both parts are **presentation-only** — no
backend, API, schema, `db.ts`, or `api.ts` shape change. Every seam below was
verified against the live tree on 2026-05-31.

**Chosen base per item**

- **P1 → clean-workflow base** (URL is the single source of truth for "which
  patient"; `PatientForm` fully converts to a page). Verified safe: `PatientForm`
  has exactly two callers (`PatientsPage`, `PatientDetail`) and P1 removes/redirects
  both, so the `<Sheet>` branch can be deleted outright rather than kept behind a
  dual-mode prop. **Grafted from minimal-diff:** thin route-page wrappers around
  the unchanged 919-line `PatientDetail`; reuse the existing `usePepProgress` hook
  (api.ts:503) for "next dose due"; the static-before-dynamic route-order callout;
  leave `ROUTE_REGISTRY` untouched.
- **P2 → minimal-diff base** (~70% already shipped; the work is closing four
  specific gaps, and the void/refund typed-reason gate is a transactions-feature
  concern — verified already implemented in `VoidDialog`/`RefundDialog`).
  **Grafted from clean-workflow:** the concrete `onKeyDown` ⌘↵ snippet, `canSubmit`
  as the single submit gate, and the `location.state` prefill finding (verified:
  `TransactionsCreatePage` does **not** read `location.state`, so prefill stays an
  optional follow-up — the bare navigate already meets the "obvious next step" bar).

**Verified facts driving the plan**

- `main.tsx` already uses `createBrowserRouter(routes)` + `RouterProvider`; `App.tsx`
  exports `routes: RouteObject[]`. No `main.tsx` change needed for either part.
- Patient routes live in the Records group: `App.tsx:235` (`{ path: '/patients', … }`).
- `usePepProgress` (api.ts:503), `usePatientSearch` (api.ts:100, fires at `q.length>=2`),
  `usePatients` infinite hook (api.ts:76, unused by the list), `useRecentList` (used by
  `PatientList`) all exist.
- `DirtyFormGuard` is exported from `@/components/layout`.
- `PatientDetail` already calls `useNavigate` (line 152), uses `onBack` only as an
  optional fallback (line 246), renders a nested `<PatientForm open={editFormOpen} …>`
  (line 835) gated by `editFormOpen` state (line 166).
- `AdministerDialog`: success state (`isComplete`, line 119) shows only a "Close"
  button (line 290); `canSubmit` (line 121) is the single submit gate; the `⌘↵` kbd in
  `ScheduledOrderDetail` (line 290) is decorative — no keydown handler exists anywhere.
- `VoidDialog.tsx` + `RefundDialog.tsx` already gate on a typed `reason` Textarea →
  P2 Gap 4 is verify-and-document only.

---

## P1 — Patient record + register/edit as full pages, persistent search switcher

### Core decision

Today `PatientsPage.tsx` (47 lines) holds `selectedId`/`formOpen` state and does a
CSS master-detail split. Make the **URL the single source of truth for the selected
patient** and delete the in-page selection state. The heavy components stay mostly
intact — they get rehosted in thin route-page wrappers, not rewritten. `PatientForm`
is the one substantive rewrite: `<Sheet>` → one-page form-commit shell.

### 1. Ordered task list (files to add / edit)

1. **`App.tsx`** — add 3 `lazy()` imports near line 19; add 3 routes in the Records
   group at line 235 (see §2 for exact placement + order). Leave `ROUTE_REGISTRY`
   (line 66) untouched — it only gates role-default landing and `/patients` already
   covers that.
2. **ADD `features/patients/PatientNewPage.tsx`** (~15 lines) — renders
   `<PatientFormPage mode="create" />`.
3. **ADD `features/patients/PatientEditPage.tsx`** (~35 lines) — reads
   `useParams<{ id: string }>()`, calls `usePatient(id)`; renders a skeleton while
   loading, `<ErrorBanner>` on error, then `<PatientFormPage mode="edit" patient={data} />`.
4. **ADD `features/patients/PatientRecordPage.tsx`** (~25 lines) — reads
   `useParams<{ id }>()`, renders `<PatientDetailHeader patientId={id} />` +
   `<PatientDetail patientId={id} />`. No `onBack` prop (internal fallback fires).
5. **ADD `features/patients/components/PatientDetailHeader.tsx`** — `<PageHeader>` with
   the in-header `<PatientSwitcher>` + an "Edit" action (`navigate(\`/patients/${id}/edit\`)`)
   - the "Next dose due" banner (see §3).
6. **ADD `features/patients/components/PatientSwitcher.tsx`** — `<Popover>` +
   `<Command>` over `usePatientSearch(q, q.length>=2)`; each result `onSelect` →
   `navigate(\`/patients/${id}\`)`. `/`focuses it (mirror`PatientList`'s `/`-to-search).
7. **REWORK `features/patients/components/PatientForm.tsx`** → `PatientFormPage`
   (rename export or keep filename; see §3). `<Sheet>/<DetailSheet>` → page shell.
   New props `{ mode: 'create' | 'edit'; patient?: PatientDetail }`. Delete the
   `<Sheet>`, `SheetHeader/Title/Description/Footer` imports and the
   `open`/`onOpenChange`/`onCreated`/`onSelected` callback contract.
8. **EDIT `features/patients/components/PatientDetail.tsx`** — (a) remove the nested
   `<PatientForm …>` (line 835), the `editFormOpen` state (line 166), the
   `PatientForm` import (line 60); (b) the Edit button `onClick` →
   `navigate(\`/patients/${patient.id}/edit\`)`. (Header search/next-dose move to
`PatientDetailHeader`.)
9. **EDIT `features/patients/PatientsPage.tsx`** — collapse to list-only:
   `return <div className="h-full"><PatientList /></div>`. Delete `selectedId`/`formOpen`
   state, the master-detail split, the embedded `<PatientForm>`.
10. **EDIT `features/patients/components/PatientList.tsx`** — replace `onSelect`/
    `onNewPatient` callbacks with `useNavigate`: row click/Enter →
    `navigate(\`/patients/${id}\`)`, New → `navigate('/patients/new')`. Drop the
`selectedId` highlight (no in-page selection). Keep arrow-key row focus.
11. **EDIT `shared/components/AppShell.tsx`** — add `'/patients/new': 'Register patient'`
    to `ROUTE_LABELS`. (⌘K patient-search group is **deferred** — the in-header
    `PatientSwitcher` satisfies the spec's mandated in-page search; touching the
    uncontrolled `CommandInput` is extra diff with no acceptance-criterion behind it.)
12. **Docs** (same PR): mark P1 done in
    `docs/handovers/archive/2026-05-31-ui-form-surface-redesign.md` §6; reconcile the
    "patient record + register/edit are full pages" note in `apps/frontend/CLAUDE.md`
    and `apps/frontend/docs/PATTERNS.md` "Form surface — overlay vs page".

### 2. Routing changes (`App.tsx`)

`main.tsx` is unchanged (already `createBrowserRouter(routes)` + `RouterProvider`).
Add to the Records group. **Static segment before the `:id` param** so `/patients/new`
isn't captured by `/patients/:id`:

```tsx
// near line 19 (lazy imports)
const PatientRecordPage = lazy(() => import('./features/patients/PatientRecordPage'))
const PatientNewPage = lazy(() => import('./features/patients/PatientNewPage'))
const PatientEditPage = lazy(() => import('./features/patients/PatientEditPage'))

// in the RequireAuthLayout children, Records group (replacing line 235)
{ path: '/patients', element: <PatientsPage /> },          // list (kept, secondary)
{ path: '/patients/new', element: <PatientNewPage /> },    // BEFORE :id
{ path: '/patients/:id', element: <PatientRecordPage /> },
{ path: '/patients/:id/edit', element: <PatientEditPage /> },
```

The data router matches most-specific first so order is technically tolerant, but
declare static-first for clarity and to avoid a future regression. `ROUTE_REGISTRY`
untouched.

### 3. Primitives / format utils / pickers

- **`PatientFormPage` shell** (canonical form-commit, PATTERNS Pattern 22):

  ```tsx
  <div className="h-full flex flex-col">
    <div className="px-4 sm:px-6 xl:px-8 py-4 border-b border-border">
      <PageHeader title={mode === 'edit' ? 'Edit patient' : 'Register patient'} description="…" />
    </div>
    <ScrollArea className="flex-1">
      <div className="px-4 sm:px-6 xl:px-8 py-4">
        <Form {...form}>
          <form id="patient-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              {/* the existing 7 section <Card>s, each keeping its inner grid-cols-2 */}
              {/* Medical-baseline card renders ONLY when mode === 'create' */}
            </div>
          </form>
        </Form>
      </div>
    </ScrollArea>
    <footer className="px-4 sm:px-6 xl:px-8 py-3 border-t border-border flex justify-end gap-2 bg-background">
      <Button
        variant="outline"
        onClick={() => navigate(mode === 'edit' ? `/patients/${patient!.id}` : '/patients')}
      >
        Cancel
      </Button>
      <Button type="submit" form="patient-form" disabled={submitDisabled}>
        {mode === 'edit' ? 'Save changes' : 'Register patient'}
      </Button>
    </footer>
    <DirtyFormGuard when={form.formState.isDirty} />
  </div>
  ```

  - Layout primitives: `<PageHeader>`, `<FormSectionHeader>` (existing per-card eyebrows),
    `<DirtyFormGuard>`, `<ErrorBanner>` (edit-load failure). `<ScrollArea>` + `<Card>` + sticky
    `<footer>` for the shell.
  - **Do not** add `max-w-*` — AppShell `<Outlet>` caps at `max-w-screen-2xl`.
  - The 17 fields fit in 2 columns of section cards at 2560px (the cards keep their
    inner `grid-cols-2` field grids), replacing the current `space-y-4` scroll tunnel.
  - Keep `buildDefaultValues`, the Zod schema, `onSubmit`, `ChipInput`, the duplicate
    panel, and the region cascade identical.
  - **Navigation, not callbacks:** create success → `navigate(\`/patients/${newId}\`)`;
    edit success → `navigate(\`/patients/${patient.id}\`)`; duplicate-panel "use existing"
→ `navigate(\`/patients/${existingId}\`)`.
  - **Preserve the create/edit divergence:** the Medical-baseline (allergies/conditions
    chips) section renders only in create mode — the backend discards those arrays on
    PATCH (documented at `PatientForm.tsx:576-582`). Keep the `mode === 'create'` guard.

- **`PatientSwitcher`**: `<Popover>` + `<Command>` (`components/ui/command.tsx`), backed
  by `usePatientSearch`. Render results with `<PatientLabel>` (showMrn) for consistency.
- **List page** stays on `<PatientList>` (uses `useRecentList` + `<TableCard>`).
- **Format utils** (`@/lib/format`): `formatLongDate` for DOB; `formatDate` for the
  next-dose banner; `font-mono tabular-nums` on MRN/IDs. `humanizeStatus` for any status pill.
- **Required-field markers**: keep `firstName`/`lastName` asterisks; while in the file,
  upgrade literal `*` in labels to `<span className="text-destructive"> *</span>` per
  the design-system convention (cheap, not gate-enforced).

**"Next dose due" banner (acceptance criterion, generalized to any standing order):**
Reuse `usePepProgress(patientId)` (api.ts:503) — its `doses[]` are generic
(`scheduledDate` + `status`), not PEP-shaped. In `PatientDetailHeader`:

```tsx
const { data } = usePepProgress(patientId)
const nextDose = data?.doses?.find((d) => d.status === 'pending') ?? null
// render: nextDose ? `Next dose: ${data.indication ?? 'Standing order'} — due ${formatDate(nextDose.scheduledDate)}`
//                  : 'No active standing order'
```

Use a single `<Badge variant="due|overdue|ok">`. Never the word "PEP" in the banner copy
— `data.indication ?? 'Standing order'`. Guard against an empty `doses[]` (returns
`status: 'not-started'` for non-standing-order patients) so `.find` on `undefined`/`[]`
renders the neutral "No active standing order" line, not a crash.

### 4. Acceptance criteria (P1)

- `/patients/new` opens the register form as a **full page** (not a 672px sheet);
  `/patients/:id` is the patient record; `/patients/:id/edit` is the edit form.
- `/patients` (list) is secondary — clicking a row navigates to the record; the list no
  longer hosts a detail split or an embedded form.
- The patient record's header carries a **persistent search switcher** that jumps
  patient-to-patient without returning to the list.
- The record shows **"next dose due" at a glance**, generalized (no "PEP" literal), with
  a neutral empty state for non-standing-order patients.
- Dirty register/edit forms block SPA-nav and tab-close via `DirtyFormGuard`.
- Register/edit lay out **multi-column** at 2560×1440 (no single-column scroll tunnel).
- Edit mode does **not** expose allergies/conditions chips (PATCH discards them).
- Breadcrumb shows "Register patient" for `/patients/new`; `:id`/`:id/edit` fall back to
  the capitalized ID segment (acceptable; name-aware crumb deferred).

### 5. CI gates (P1) + how to stay green

- **`scripts/check-design-system.sh` + ESLint `no-restricted-syntax`**: the new
  `PatientFormPage` must **not** hand-roll `<SheetContent side="right">` (it's _removing_
  one — compliant) and must **not** introduce `<h1 className="text-lg font-semibold">` —
  use `<PageHeader>`. `PatientSwitcher` uses `<Popover>`/`<Command>`, not a Sheet — fine.
  `PatientList.tsx`'s existing raw `<h1>` (line 187) is **already allowlisted** — don't
  add a new exception, don't add new raw `<h1>`s elsewhere.
- **`scripts/check-tailwind-tokens.sh`**: no arbitrary `text-[Npx]` — the form already
  uses scale tokens; keep it that way.
- **Dialog a11y / sentence case**: N/A for the form page (no `<DialogTitle>`); if any
  confirm dialog is added, sentence-case title + `<DialogDescription>` + `Cancel` label.
- **`format:check` is CI's first step**: end every edit batch with
  `pnpm prettier --write <touched>` then `pnpm format:check` (fall back to
  `pnpm prettier --write .` if a localized write still fails). Typecheck-green ≠ CI-green.
- **No `.data` unwrap drift**: the patient list/detail/search hooks already consume the
  correct shapes — don't introduce `(await res.json()).data` anywhere.

### 6. P1 risks

1. **Route-order trap** — `/patients/new` must precede `/patients/:id`. Declared above.
2. **Dead Sheet path** — fully remove `PatientForm`'s `<Sheet>` branch and the
   `editFormOpen` state in `PatientDetail`; verified only two callers, both handled.
   Grep `PatientForm` after the edit to confirm no stray importer keeps the old contract.
3. **`usePepProgress` empty state** — `.find` on an empty/undefined `doses[]` must render
   the neutral line, not crash.
4. **Edit-mode medical-baseline** — keep the `mode === 'create'` guard so `/edit` never
   shows editable allergy/condition chips that the backend silently drops.
5. **Lost selected-row highlight** — minor UX (list is now secondary); acceptable per spec.

---

## P2 — Scheduled Orders polish (the daily workhorse)

### Current state vs. spec

The page (514 lines) already: defaults to the Due-today tab, urgency-sorts into
Overdue/Due lanes, has separate Overdue + Backfill tabs, uses `text-xs`/`tabular-nums`,
applies the severity `stripe` (`data-severity`), and keeps Administer as an overlay
reusing the existing encounter. P2 closes **four gaps** — refinement, not rebuild.
**No routing change.** Administer stays a `<Dialog>` overlay (spec is explicit).

### 1. Ordered task list (files to edit — no files added)

1. **EDIT `features/scheduled-orders/components/AdministerDialog.tsx`** —
   - Add a ⌘↵/Enter submit handler on `<DialogContent>` (Gap: keyboard-driving).
   - Add a primary **"Collect payment →"** action in the success (`isComplete`) footer,
     alongside the existing "Close" (Gap: payment as the clear next step).
   - Accept `patientId` via `orderSummary` (passed by the detail) for the payment hand-off.
2. **EDIT `features/scheduled-orders/components/ScheduledOrderDetail.tsx`** —
   - Add a ⌘↵ keydown listener (scoped to the detail / not-completed state) that opens
     `AdministerDialog`, making the decorative `⌘↵` kbd (line 290) real.
   - Pass `patientId` (the detail already has `order.patient`) into the
     `AdministerDialog` `orderSummary`.
3. **EDIT `features/scheduled-orders/ScheduledOrdersPage.tsx`** — density pass:
   collapse the redundant "Late-dose recompute" inline sub-text (the stripe + lane
   already convey overdue) so each row shows **one severity signal** (stripe) + at most
   one status badge + the action button. Tighten row padding to a `py-1.5`-class row;
   keep the `text-xs` floor and `tabular-nums`.
4. **(Verify only) `features/transactions/components/VoidDialog.tsx` +
   `RefundDialog.tsx`** — confirmed already gate on a typed `reason` Textarea. **No
   change.** Document in the handover that the payments-hard-gate criterion is satisfied
   in the transactions feature, not scheduled-orders.
5. **Docs** (same PR): mark P2 done in
   `docs/handovers/archive/2026-05-31-ui-form-surface-redesign.md` §6; reconcile the daily-loop
   description in `apps/frontend/CLAUDE.md`.

### 2. Routing changes (P2)

**None.** `/scheduled-orders` stays a single route; Administer, Reschedule, and
Append-external-dose stay overlays. No `App.tsx` / `main.tsx` edit. (This is what lets
P2 land in parallel with P1 — see §6.)

### 3. Primitives / format utils

All existing — no new primitive:

- `<PageHeader>`, `<KpiStrip>` + `<KpiCell>` (tones overdue/due/ok), `<PageToolbar>`,
  `<TableCard>`, `<Tabs>` (segmented filter), `<Dialog>` (Administer stays a Dialog,
  not DetailSheet — focused confirm, ≤5 controls).
- Severity: `data-severity` + `stripe` class (one stripe per row); `<Badge
variant="overdue|due|ok|info">` for the single status badge.
- Format: `formatDate`/`formatTime` for due times, `font-mono tabular-nums` on
  due-times/doses/lot codes, `humanizeStatus` for pills, `formatMoney` if any amount renders.

**⌘↵ submit (`AdministerDialog`)** — graft the concrete snippet, gated by the existing
single `canSubmit`:

```tsx
<DialogContent
  onKeyDown={(e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isComplete && canSubmit) {
      e.preventDefault()
      handleSubmit()
    }
  }}
>
```

Make the consent `<Checkbox>` (already first focusable) reachable; Radix Dialog traps
focus. Keep `canSubmit` (line 121) as the **single** gate — it already folds in consent

- dose-calc-ready, so ⌘↵ stays disabled until the dose calculator is filled for
  `requiresDoseCalculation` services.

**Open-administer-from-detail (`ScheduledOrderDetail`)** — scope the listener so it
doesn't fight AppShell's global ⌘K (AppShell binds ⌘K at line ~435):

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isCompleted) {
      e.preventDefault()
      setAdministerOpen(true)
    }
  }
  // only while the detail rail is open
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [isCompleted])
```

**"Collect payment →" success footer (`AdministerDialog`)** — sequential, never combined:

```tsx
{
  isComplete && (
    <>
      <Button onClick={() => navigate('/transactions/new')}>Collect payment →</Button>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        Close
      </Button>
    </>
  )
}
```

Add `useNavigate`. **Prefill is optional/deferred:** verified `TransactionsCreatePage`
does **not** read `location.state`, so passing patient/order context via router `state`
is a no-op today — the bare `navigate('/transactions/new')` already satisfies "payment
as the obvious next step." If prefill is wanted later, it needs a small read in the
create page (separate follow-up). Do not add unused `state:` payloads.

### 4. Acceptance criteria (P2)

- Administer is **operable end-to-end by keyboard**: ⌘↵ from the detail opens the dialog;
  ⌘↵ inside the dialog confirms when `canSubmit`; consent toggles by keyboard.
- After a successful administer, the dialog presents a **primary "Collect payment →"**
  action navigating to `/transactions/new`, with "Close" secondary — administer and
  payment stay **sequential** (never one combined screen).
- The worklist is **visibly denser**: one severity signal per row (stripe), `text-xs`
  floor, `tabular-nums`, tighter row padding; redundant inline "recompute" text removed.
- Default tab is Due-today, urgency-sorted (Overdue → Due); Overdue and Backfill remain
  separate tabs (already true — don't regress).
- Void/refund stays **hard-gated with a typed reason** (verified in the transactions
  feature; no change here).
- Administer remains an **overlay** (no page conversion).

### 5. CI gates (P2) + how to stay green

- **`scripts/check-tailwind-tokens.sh`**: density pass uses scale tokens only —
  `text-xs` (12px) floor for readable cells, `text-2xs` (10px) only for kbd/badge
  micro-text. No arbitrary `text-[Npx]`.
- **Dialog a11y (Wave 6)**: `AdministerDialog` already has a sentence-case
  `<DialogTitle>` ("Administer dose" / "Dose administered") + `<DialogDescription>`.
  The new "Collect payment →" button keeps sentence case and **no color words**. Keep
  "Close" in the post-action read-only state (correct per Wave 6) and "Cancel" pre-submit
  — don't regress these.
- **`scripts/check-design-system.sh` / ESLint**: don't introduce a `<SheetContent
side="right">` or a hand-rolled KPI; the page already uses `<KpiStrip>`. One stripe +
  ≤1 badge per row (don't add a second status color).
- **`format:check`**: `pnpm prettier --write <touched> && pnpm format:check` after the batch.

### 6. P2 risks

1. **⌘↵ global-listener conflict** — scope the detail listener to the open detail /
   not-completed state and `preventDefault` so it never fires from unrelated pages or
   fights AppShell's global ⌘K.
2. **Dual "today" seam** — `db.ts` computes today in server-local time; the page in
   browser-local (`ScheduledOrdersPage.tsx:306-307`). Pre-existing, **out of scope**
   (presentation-only; a fix touches backend). Flag for a follow-up `clinicToday()` util,
   don't fix here.
3. **Payment prefill** — verified not consumed by `TransactionsCreatePage`; keep the
   hand-off as a bare navigate, don't ship dead `state:` payload.
4. **Recall warning persists post-administer** (`AdministerDialog:67`) — a pre-dose FEFO
   recall preview needs a backend endpoint; explicitly out of scope. Leave the
   documented limitation.

---

## Cross-cutting: aesthetic, sequencing, parallel-safety

**Stock-shadcn only** (hard user preference): blue accent, white background, Inter,
0.5rem radius. No inline hex/oklch, no custom button/badge components (extend the cva
blocks in `button.tsx`/`badge.tsx`), no decorative gradients/shadows, no emojis, no
color words in copy ("the overdue ones", not "the red ones").

**Sequencing to avoid `App.tsx` edit races if P1 and P2 run in parallel:**

- P1 and P2 touch **disjoint feature dirs** — `features/patients/**` vs
  `features/scheduled-orders/**`.
- **Only P1 edits `App.tsx`** (adds the three patient routes) and `AppShell.tsx` (one
  `ROUTE_LABELS` entry). **P2 edits neither** — its route already exists and Administer
  stays an overlay.
- Therefore land as **two independent PRs with zero shared-file overlap → no rebase
  cascade.** No coordination needed beyond both ending with `format:check`.
- If implemented as orchestrate units: assign `App.tsx` + `AppShell.tsx` exclusively to
  the P1 unit; the P2 unit must not touch them. Land order doesn't matter (no shared
  file), but P1 is the larger refactor and the bigger UX win — sequence it first or in
  parallel, P2 is purely additive.

**Docs to update (Doc Propagation rule, in the owning PR):**
`docs/handovers/archive/2026-05-31-ui-form-surface-redesign.md` §6 (mark P1/P2 done),
`apps/frontend/CLAUDE.md` (reconcile the full-page-record + daily-loop notes),
`apps/frontend/docs/PATTERNS.md` ("Form surface — overlay vs page").

**Relevant absolute paths:**
`apps/frontend/src/App.tsx`,
`apps/frontend/src/shared/components/AppShell.tsx`,
`apps/frontend/src/features/patients/{PatientsPage,api}.ts(x)`,
`apps/frontend/src/features/patients/components/{PatientList,PatientDetail,PatientForm,PepScheduleTab}.tsx`,
`apps/frontend/src/features/scheduled-orders/ScheduledOrdersPage.tsx`,
`apps/frontend/src/features/scheduled-orders/components/{ScheduledOrderDetail,AdministerDialog}.tsx`,
`apps/frontend/src/features/transactions/components/{VoidDialog,RefundDialog}.tsx` (verify-only),
`apps/frontend/src/components/layout/index.ts` (barrel — `DirtyFormGuard` confirmed).
