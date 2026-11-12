> **Archived 2026-06-12** — open items folded into
> [`../2026-06-04-state-of-the-art.md`](../2026-06-04-state-of-the-art.md).

# 2026-06-12 UI architecture pass — what shipped, backend needs, deferred items

> **ARCHIVED 2026-06-13** — fully resolved: backend needs shipped in PR #557,
> API contract codegen in #558/#559. Open remainders (`GET /api/today`
> projection, visual-baseline CI job, codegen long tail) carried into
> [`../2026-06-04-state-of-the-art.md`](../2026-06-04-state-of-the-art.md).

Third UI pass of the day (after the 27" revamp and the creative pass).
Frontend-only. This doc captures (a) backend changes that would complete
it, (b) improvements deliberately deferred — including the power-user
items the user explicitly excluded.

## Shipped (frontend)

- **Today cockpit** (`/today`, Pattern 33) — workflow-first home: In
  clinic / Due now / Awaiting payment / Done today lanes composing
  existing hooks; one deep-link action per card; post-login default.
- **Surface zones** (Pattern 25 update) — chrome bands on `bg-card`,
  tinted scroll canvas, `TableCard` + lane cards get `shadow-sm`.
- **Confident type ramp** — PageHeader title `text-xl 2xl:text-2xl`.
- **Light sheet scrim** — detail rails no longer dim the list
  (`bg-foreground/25`, `2xl:bg-foreground/10`).
- **URL-as-state** (Pattern 34) — `?selected=` on ScheduledOrders,
  `?status=` on Transactions (both already had `q`/`tab`/`date`).
- **Ambient status chips** — topbar "Drawer open" + "N unsettled"
  click-to-act chips (Branch role; zero new queries).

## Backend needs

1. ~~**Normalize money strings on `/api/transactions` list rows.**~~
   Fixed independently in
   [#554](https://github.com/njvil/surevax-cms-revamp/pull/554) (raw
   numeric strings now cross the API); the TodayPage comma-strip
   workaround was removed in the second pass.
2. **A real "today queue" endpoint (eventually).** The cockpit fires 4
   queries (dashboard, scheduled today, scheduled overdue, pending
   txns). Fine at clinic scale; a single
   `GET /api/today` projection would cut latency and let lanes carry
   richer state (e.g. payment status on dose cards, dose number on
   pending-txn cards).
3. ~~**Encounter deep-link.**~~ Shipped in the second pass —
   EncountersPage consumes `?selected=` and the cockpit's In clinic /
   Done today cards deep-link with the encounter pre-selected.
4. ~~Still open from the creative pass~~ All three shipped 2026-06-12
   (handover-cleanup wave): KPI trend series for sparklines, per-dose
   states on the patients list, and the `pepTotal: null` projection bug —
   see [2026-06-12-ui-creative-pass-backend-needs.md](2026-06-12-ui-creative-pass-backend-needs.md).

## Deferred UI work (not backend)

Updated 2026-06-12 (second architecture pass) — three of the five
deferred items SHIPPED:

- ✅ **Continuous administer flow** — Pattern 35. Review → administer →
  collect run inline in the ScheduledOrderDetail rail via
  `AdministerPanel`/`CollectPaymentPanel` (dialog wrappers kept for the
  Arrivals hand-off).
- ✅ **Non-modal master-detail at 2xl** — `<DetailRail>` (Pattern 6):
  worklist rails drop the scrim/focus-trap at 2xl; clicking another row
  switches selection directly. 10 list surfaces swapped.
- ✅ **Visual regression (local-first)** — `e2e/visual.spec.ts`, opt-in
  via `VISUAL=1`, 2560×1440 snapshots of cockpit + 3 worklists; darwin
  baselines committed. CI skips until linux baselines are generated in
  CI (follow-up: a baseline-update job).
- ❌ **Command-verb bar** ("collect 500 garcia") — **explicitly excluded
  by the user as power-user scope.** Don't build without a fresh ask.
- ✅ **API contract codegen** — SHIPPED 2026-06-13. Per-module `contract.ts`
  - `pnpm gen:contracts` + CI drift gate; 15 modules converted, frontend
    api.ts files alias generated types. Design:
    [`docs/specs/api-contract-codegen.md`](../../specs/api-contract-codegen.md);
    conventions in `.claude/rules/gotchas.md` "Schema ↔ Zod ↔ frontend field
    parity". Remaining unconverted modules (admin sub-routers, fhir,
    attachments, branch, shifts, cash_drawer, service_catalog, places,
    product_recalls, staff_time_logs, operator, health_cards, dose_calc) —
    convert on next touch.
