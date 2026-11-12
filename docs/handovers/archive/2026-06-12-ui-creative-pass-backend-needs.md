> **Archived 2026-06-12** — open items folded into
> [`../2026-06-04-state-of-the-art.md`](../2026-06-04-state-of-the-art.md).

# 2026-06-12 UI creative pass — backend needs (frontend shipped without them)

> **ARCHIVED 2026-06-13** — fully resolved: both backend needs shipped in
> PR #557. The ⌘K nice-to-haves are carried into
> [`../2026-06-04-state-of-the-art.md`](../2026-06-04-state-of-the-art.md).

The typography/identity + clinical-primitives pass (PR follows the 27"
revamp PR #550) was deliberately **frontend-only**. The items below are
the backend changes that would let the new primitives reach full value.
None are blockers — every frontend surface degrades gracefully today.

## 1. ~~KPI trend series for `<KpiCell trend>` / `delta` (Pattern 18/32)~~ — SHIPPED 2026-06-12

Landed in the handover-cleanup wave: `GET /api/dashboard` returns
`trend7d { arrivals, revenue, unsettled }`, the `/api/transactions` stats
sidecar returns `trend7d.revenue` + `revenueVsPrevDay` (Paid-only, same
filter AND same JS-midnight clock as `todayRevenue` so the sparkline's
final point matches the KPI value), and `/api/scheduled-orders` stats
returns `administered7d`. All three pages pass the series into
`<KpiCell trend>`. Original ask kept below for reference.

`KpiCell` accepts `trend: number[]` (renders a `<Sparkline>`) and
`delta` (period-over-period line).

Wanted, per surface (oldest → newest, 7 daily points is enough):

- `GET /api/dashboard` (or its stats payload): 7-day series for
  arrivals/day, revenue/day (`is_prepayment=false`, non-Voided/Refunded
  per the revenue-aggregate rule in `patterns.md`), unsettled count/day.
- `GET /api/transactions` `stats`/`dayStats` sidecar: 7-day revenue +
  txn-count series, plus "vs previous day/week" deltas if cheap.
- `GET /api/scheduled-orders` `stats` sidecar: 7-day administered-count
  series.

Shape suggestion: `{ ..., trend7d: { arrivals: number[], revenue: string[] } }`
— numeric strings fine for money (frontend parses for the sparkline).
Series must be tenant+branch-scoped like the existing aggregates.

## 2. ~~Per-dose schedule states on the patients list (Pattern 13)~~ — SHIPPED 2026-06-12

`/api/patients` list rows now carry
`doseStates: Array<'done' | 'due' | 'overdue' | 'upcoming'>` for the
patient's most-recent Active standing-order course (lane rules mirror
`ScheduledOrdersPage`), and `PatientList.tsx` feeds it into
`<DoseStrip size="sm">`.

The `pepTotal: null` bug is fixed with it — root cause: the old
projection subqueries filtered on `clinical_orders.indication`, a column
neither the seed nor any standing-order creation path populates.
`pepCompleted`/`pepTotal` now derive from the same dose-state array.

## 3. ⌘K patient search — works today, optional upgrades

The command-palette patient search reuses `GET /api/patients?q=&limit=10`
(same as registration dedupe) — no backend change needed. Nice-to-haves
if it grows: relevance ranking (prefix match on last name > contains),
and matching on phone fragments (the `q` matcher may already cover
this — unverified).

## 4. Not needed (explicitly)

- Fonts: self-hosted via `@fontsource-variable/*`, no backend/CDN work.
- DoseStrip on the patient record card: uses existing encounter data
  (currently the demo D0–D14 array in `PatientDetail.tsx` — wiring it
  to real standing-order data is frontend work once #2 lands).
