# Handover · Claude-Design UI density batch (2026-04-28)

> **Audience:** the engineer (or agent) wiring up the backend endpoints / fields
> that the UI density work is now waiting on. Read top to bottom.

## What just shipped

A 5-PR batch from the [Claude Design handoff][design-tarball] applied a clinical
conventions layer plus the artboard's UI density across four pages — UI only,
mock data behind every gap. All five PRs are merged to `main` as of
2026-04-28:

| PR                                                         | Scope                                          | Files of note                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#62](https://github.com/njvil/surevax-cms-revamp/pull/62) | Conventions layer (theme + agent docs)         | `apps/frontend/src/index.css`, `tailwind.config.ts`, `components/ui/badge.tsx`, `apps/frontend/{CLAUDE.md, docs/PATTERNS.md, docs/COMPONENT-MAP.md}` |
| [#63](https://github.com/njvil/surevax-cms-revamp/pull/63) | Dashboard density                              | `apps/frontend/src/features/dashboard/DashboardPage.tsx`                                                                                             |
| [#64](https://github.com/njvil/surevax-cms-revamp/pull/64) | Scheduled-orders swimlanes + protocol-timeline | `apps/frontend/src/features/scheduled-orders/{ScheduledOrdersPage.tsx, components/ScheduledOrderDetail.tsx}` (formerly `features/recall/`)           |
| [#65](https://github.com/njvil/surevax-cms-revamp/pull/65) | Arrivals Step 3 + Transactions Create          | `apps/frontend/src/features/arrivals/steps/Step3Protocol.tsx`, `features/transactions/{TransactionsCreatePage.tsx, components/TenderRail.tsx}`       |

[design-tarball]: https://api.anthropic.com/v1/design/h/PL0k_fV2Ic3kIj3JIrNThQ

The user's instruction was explicit: **stock-shadcn theme stays — no warm
paper, no orange accent, no Plex font, no 4 px radius.** The design's
_conventions_ layer landed (severity-stripe rows, clinical badge variants,
eyebrow labels, mono-for-facts) but the _aesthetic_ layer didn't.

If you're new here, the conventions are documented in:

- [`apps/frontend/CLAUDE.md`](../../apps/frontend/CLAUDE.md) — three rules for
  building UI: shadcn-first, no inventing colors, extend-don't-fork.
- [`apps/frontend/docs/PATTERNS.md`](../../apps/frontend/docs/PATTERNS.md) —
  10 clinical UI patterns (severity stripe, worklist, atomic-commit block,
  payment-gates-clinical, multi-step wizard, sheet-not-dialog, command palette,
  mono for facts, eyebrow labels, KPI strip).
- [`apps/frontend/docs/COMPONENT-MAP.md`](../../apps/frontend/docs/COMPONENT-MAP.md)
  — clinical concept → shadcn primitive lookup.

## How the wiring is currently laid out

Every mocked surface is marked with a single grep-able token:

```bash
grep -rn "TODO(backend)" apps/frontend/src/features
```

That returns the full list of fields/endpoints the next pass needs to wire.
The bullets below group those TODOs by destination feature so a backend
engineer can plan endpoint work alongside the frontend.

## Backend gaps to wire — by feature

### Dashboard (`features/dashboard/DashboardPage.tsx`) — ✅ WIRED 2026-04-29

Every TODO in this section is now wired against live data. Notes:

- `/api/dashboard.stats.{walkInCount, bookedCount}` — split via `chiefComplaint`
  heuristic (encounters whose chief complaint contains "walk" / "scheduled" or
  has a linked PSO bucket as booked, otherwise walk-in). Phase 2 will derive
  from a dedicated `arrival_kind` column.
- `/api/dashboard.stats.unsettledTotal` (₱) — `SUM(netAmount)` over today's
  Pending + Draft transactions. Frontend renders as `₱<amount>` with locale
  formatting.
- `/api/shifts/current` extension — added `startedAt` (alias of `openedAt`),
  `drawerBalance` (= `floatAmount + collectedSoFar`), `encountersBookedToday`
  (branch-scoped), `dosesAdministeredToday` + `dosesScheduledToday` +
  `complianceRate` (caller-scoped). Both the cashier `TenderRail` and
  Dashboard's drawer KPI cell + "Shift" lower card consume the same shape.
- `/api/dashboard/nudges` — server-ranked priority queue. Phase 1 ranker:
  union of (a) overdue/due clinical_orders, (b) Pending transactions older
  than 2h, (c) inventory lots expiring within 30d, sorted overdue→due→info,
  capped at 20 rows. Each row: `{ id, kind, label, sub, severity, dueAt, link }`.
- `/api/dashboard.recentEncounters[].patientDisplayId` — exposed (the patient
  PK _is_ the display id since the UUID-removal refactor).
- `/api/dashboard.recentEncounters[].attendingClinicianName` — concat
  `users.firstName + ' ' + users.lastName` of the encounter provider.
- `/api/audit/recent?hours=24` — new module, NOT under `/api/admin/*`. Returns
  up to 50 audit_logs entries; `?hours` capped at 168 (one week). Severity
  mapping: `CROSS_BRANCH_ACCESS / TRANSACTION_MODIFY / SCHEDULE_CHANGE / DELETE`
  → `warning`, everything else → `info`. Phase 1 message string: short human
  form like `"<userName> <action> <entityType>"`.

### Scheduled Orders (`features/scheduled-orders/ScheduledOrdersPage.tsx` + `ScheduledOrderDetail.tsx`)

Lists wire from `useScheduledOrders(query, filter)`; detail rail wires from
`useScheduledOrder(id)`.

| What                                                                                         | Where it shows up                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ScheduledOrder.patientDisplayId`                                                            | Mono `PT-…` ID line per row                                                                                |
| `ScheduledOrder.totalDoses` (or `template.doseCount`)                                        | "Dose X of Y" step column                                                                                  |
| `ScheduledOrder.blockerReason`                                                               | Sub-line under Step ("Late-dose recompute", "Triage pending")                                              |
| `ScheduledOrder.{paymentStatus, paymentAmount}`                                              | Payment column (joined from linked transaction) — currently mock-hashed by `order.id`                      |
| `ScheduledOrdersStats.activeCoursesCount`                                                    | Header eyebrow "N active courses"                                                                          |
| `ScheduledOrdersStats.recomputeNeededCount`                                                  | Warning Alert badge (currently hardcoded `2`)                                                              |
| `GET /api/scheduled-orders/{id}/timeline`                                                    | Right-rail dose timeline — `[{day, scheduledAt, administeredAt, state, byClinician, lotNumber, doseSize}]` |
| `GET /api/scheduled-orders/{id}/recompute-preview`                                           | "On commit · recompute & administer" Card (currently 3 hardcoded effects)                                  |
| `POST /api/scheduled-orders/{id}/recompute` and `POST /api/scheduled-orders/{id}/administer` | Sheet footer buttons (currently `disabled` with `title="UI only — backend wiring not yet"`)                |

### Arrivals · Step 3 (`features/arrivals/steps/Step3Protocol.tsx`)

Already wires `useStandingOrderTemplates()` and `useStandingOrderTemplate(id)`
for protocol catalog + day-offset schedule. The mocked surfaces are the FEFO
bundle preview + the atomic commit.

| What                                                                                     | Where it shows up                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `encounter.triageCategory`                                                               | "CAT-3 EXPOSURE" outline Badge in step header + sub-line                                               |
| `GET /api/arrivals/preview-bundle?protocol=<id>&triageCategory=<cat>&patientWeight=<kg>` | FEFO Bundle table — returns `[{service, lot, expiryDate, dose, qty, unitPrice, subtotal}]`             |
| Bundle commit side-effects                                                               | Right-rail "On commit" 4-effect summary (Encounter / Protocol_run / Lots reserved / Draft transaction) |
| `POST /api/arrivals/atomic`                                                              | Single-transaction commit creating encounter + protocol_run + lot reservations + draft transaction     |
| `encounter.patient.displayId`                                                            | "Encounter created · PT-…" sub-line in commit-rail summary                                             |
| `usePhysicians` hook adoption                                                            | Replace free-text physician input on the `requiresPhysicianAuth` path                                  |

### Transactions Create (`features/transactions/TransactionsCreatePage.tsx` + `TenderRail.tsx`) — ✅ WIRED 2026-04-29

Every TODO in this section is now wired against live data. Notes:

- `service.sku` — added as a nullable column on `service_catalog` and exposed in
  `GET /api/services`. Cart row renders `service.sku ?? service.code`. Until
  the BIR catalog is populated, every row falls back to `code`.
- `service.isVatExempt` — added to the `GET /api/services` select; the VAT
  badge is driven directly from the service row, no manual checkbox needed.
  The per-item RHF checkbox is now an override (auto-defaulted on submit
  from `service.isVatExempt`).
- TXN id — `POST /api/transactions` already returned `{ id }`; the page now
  reads `createTxn.data?.id` instead of the `TXN-2026-PREVIEW` mock.
- `/api/shifts/current` — new module under `apps/backend/src/modules/shifts/`;
  returns `{ openedAt, floatAmount, collectedSoFar, drawerState, cashierName }`
  for the caller's open shift today (`null` when no shift). `floatAmount` +
  `drawerState` are stored on `staff_time_logs`; `collectedSoFar` sums today's
  payments received by the caller. Frontend hook: `useCurrentShift()` in
  `apps/frontend/src/features/shift/api.ts`. The drawer card falls back to
  em-dashes + a "clock in to track the drawer" hint when `null`.
- `encounter.bundleLabel` — derived server-side from `specialty`
  (`apps/backend/src/modules/encounters/db.ts:deriveBundleLabel`). Phase 1
  mapping: Rabies → "Rabies PEP bundle", Flu → "Flu vaccination", etc.
  Day-offset enrichment (e.g. "Day 0 · Rabies PEP") is deferred until the
  arrivals atomic-commit endpoint lands and the PSO/clinical-order linkage
  becomes available.
- FSM badge — small helper `statusToFsmLabel(status)` in
  `apps/frontend/src/features/transactions/lib.ts` maps the existing
  `transaction.status` enum to the FSM label the design expects
  (`Pending → awaiting_payment`, `Paid → paid`, etc.).
- OR (Official Receipt) number — `transactions.or_number` column added; UNIQUE
  per `(tenant_id, or_number)`. Issued atomically the first time the txn
  transitions to `Paid` — either via the inline-payment branch of `POST /api/transactions`
  or via the standalone `POST /api/transactions/:id/payments`. Format:
  `OR-{YYYY}-{base32 random}`.
- Inline payment on `POST /api/transactions` — request body now accepts an
  optional `payment: { method, amount, referenceNumber?, payerId?, notes? }`.
  When present, the create flow records the payment + transitions status +
  issues the OR number in the same DB transaction. Response shape extended to
  `{ id, status, orNumber, paymentId }`. The frontend's `TenderRail` lifts
  `method` + `tendered` into the parent page so the create payload carries
  them on submit.

The "Split" payment method on the rail still just maps to `Cash` for the
inline-payment path; multi-method tendering will land with the cashier-shift
reconciliation batch.

## Conventions the next pass should follow

When wiring a backend field, **don't** introduce new visual concepts; reuse
the existing tokens and patterns:

1. **Severity is data, not styling.** Map a backend value to one of
   `'overdue' | 'due' | 'ok' | 'info'` and let `<Badge variant={…}>` /
   `[data-severity={…}].stripe` paint it. Never hand-pick a Tailwind color
   like `border-l-red-500` — that's been removed elsewhere.
2. **Numbers, IDs, money, times, doses, lot codes** all use Tailwind
   `font-mono tabular-nums`. The mono stack is the stock default; no Plex.
3. **Eyebrow labels** are `<span className="eyebrow">…</span>` (plain CSS
   in `apps/frontend/src/index.css`).
4. **Atomic-commit blocks** (`PATTERNS.md` §3) — when a mutation writes more
   than one row, render the "On commit · what writes" summary panel with a
   numbered list of effects + severity dots, _then_ the primary CTA.
5. **Payment-gates-clinical** (`PATTERNS.md` §4) — any clinical action that
   depends on a paid transaction shows a destructive `<Alert>` banner above
   the action area, and the action button is `disabled` with a clear title.

## Known follow-up work

- **DOC-DRIFT**: `scripts/check-doc-surface.sh` flagged
  `apps/frontend/src/features/admin/ApprovalsPage.tsx` against
  `docs/ai-context/03-FRONTEND-UI-UX.md` during PRs #64 and #65 — out of scope
  for that batch. A small follow-up PR should refresh the Approvals row in
  that doc to match the current page.
- **`format:check` drift on main** — twice during this batch CI flagged 9
  pre-existing files (`.claude/rules/{batch,commits}.md`,
  `apps/frontend/CLAUDE.md`, `apps/frontend/docs/{PATTERNS,COMPONENT-MAP}.md`,
  `apps/frontend/src/features/transactions/api.ts`,
  `apps/frontend/src/index.css`,
  `docs/ai-context/{02-BACKEND-API,03-FRONTEND-UI-UX}.md`) as unformatted.
  PRs #63–#65 each carried their own prettier-write commit; main is clean
  now. Future PRs spawned from `main` shouldn't see the drift again, but if
  it returns, run `pnpm prettier --write <files>` and commit.
- **Worker rough edges** observed during this batch (logged here so the next
  `/batch` run can defuse them up front):
  1. `Agent isolation:"worktree"` forks workers from `main` HEAD, **not**
     from the coordinator's current branch. Land any prerequisite commit to
     `main` (or have workers rebase explicitly) before spawning.
  2. Two of three Sonnet workers ended their final message without a
     `PR: <url>` line and their worktrees were auto-cleaned without a push.
     The replacement worker prompt now requires explicit verification of the
     `git push -u origin HEAD` exit code and a `gh pr view <num>` round-trip
     before reporting. Re-using that worker tail (see
     `/Users/njvil/.claude/plans/fetch-this-design-file-smooth-naur.md`)
     prevents silent drops.

## How to pick this up

If you are wiring a single backend field:

1. Pick a row from the tables above.
2. Find the corresponding `// TODO(backend): …` comment in the named file.
3. Add the field to the backend response (see `docs/ai-context/02-BACKEND-API.md`
   for the canonical patterns, and the per-feature `db.ts` / `service.ts`
   under `apps/backend/src/modules/`).
4. Type the new field in the frontend `api.ts` for the relevant feature.
5. Replace the mock with the wired value; remove the `// TODO(backend)`
   comment.
6. Verify `pnpm --filter @surevax/frontend typecheck` + `build` are still
   clean and the page renders.

If you are wiring an entire feature (e.g. all of Scheduled Orders):

1. Read this handover end-to-end.
2. Read the corresponding feature's section in `docs/ai-context/`
   (`02-BACKEND-API.md` for endpoint patterns, `06-PRODUCT-WORKFLOWS.md` for
   clinical context).
3. Implement the new endpoints + extend the Drizzle schema if needed.
4. Replace mocks per the per-row table above; ship one PR per logical unit
   (don't bundle Dashboard + Scheduled Orders in the same PR).

## References

- Design source: `https://api.anthropic.com/v1/design/h/PL0k_fV2Ic3kIj3JIrNThQ`
  (open in Claude Design — opens the SureVax CMS Assessment artboards).
- Plan file (private to the coordinator's `~/.claude/plans/`):
  `fetch-this-design-file-smooth-naur.md` — full unit decomposition + worker
  prompt template.
- Repo conventions: `apps/frontend/CLAUDE.md`, `apps/frontend/docs/PATTERNS.md`,
  `apps/frontend/docs/COMPONENT-MAP.md`.
