# 2026-05-10 — Search-first browse + branch-day reconciliation

## Summary

Two threads of work in one session, both starting from a comprehensive frontend UI audit:

1. **Branch-day reconciliation suite** — a clinic's Branch session is day-scoped (one Branch login per day, multiple nurses share it). Built the surfaces that make this explicit: a Day Summary page, day-scoped Transactions and Inventory lenses, a Clinical Orders "Administered today" tab, cash-drawer open/close UI, and Branch-session day-aware UI (banner, day-open prompt, day-close warning, cross-midnight toast).
2. **UX papercut sweep + search-first records browse** — `apiErrorMessage` helper, `formatPhpAmount`/`DASH` consolidation in `lib/format.ts`, `STATUS_VARIANT` consolidation in `lib/status.ts`, mutation `onError`+`invalidateQueries` sweep, PatientsPage migrated from `ResizablePanelGroup` to `Sheet`, and Pattern 24 (`useRecentList` + cursor headers) infrastructure with PatientList as the first adopter.

15 PRs shipped (#258, #259, #260, #261, #262, #263, #264, #265, #266, #267, #268, #269, #270, #271 hotfix + this docs PR).

## Operational model — Branch-day session

This is the load-bearing decision. **A Branch account logs in once per day; multiple nurses operate under that single session simultaneously.** End-of-day reconciliation is therefore branch-wide, not per-user. Per-user attribution comes from `administered_by_id` / `documented_by_id` recorded on each write, not from the session identity. Role-based operations (per-user filters, my-shift dashboards) are **explicitly deferred**.

Memory: [`memory/project_branch_day_session_model.md`](.claude/projects/-Users-njvil-Documents-Personal-Projects-surevax-cms-revamp/memory/project_branch_day_session_model.md).

How to apply when designing new features:

- Reconciliation views (Day Summary, day-scoped Transactions, Administered tab) scope by `branch_id + date::day` — never by `user_id` / `current_shift`.
- Date-scope picker is "Today / Yesterday / Pick date." There is no "current shift" toggle.
- Totals (revenue, administrations, drawer balance) aggregate across all nurses on the day.
- Per-row attribution shows in the row but does not filter the list.
- Existing `staff_time_logs` / shift clock-in infrastructure stays — it logs activity but does not gate the reconciliation surfaces.
- Default to branch-wide aggregation. Don't add per-user filters until the user explicitly asks for role-based ops.

## What landed

### Branch-day reconciliation

| PR                                                           | What                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#260](https://github.com/njvil/surevax-cms-revamp/pull/260) | Day Summary page + endpoint at `/day-summary`. Five card blocks (Transactions, Administrations, Encounters, Inventory movements, Cash drawer). One `db.transaction` with RLS GUCs; aggregations parallel via `Promise.all`. Branch resolved server-side from `req.user.branchId`.                                                                                                                                     |
| [#261](https://github.com/njvil/surevax-cms-revamp/pull/261) | Transactions list day-scoped (default = today, prev/next/Today picker, inline totals readout, status tabs become filters within the day). New `getTransactionDayStats()` returns `dayStats` payload only when `?date=` is passed.                                                                                                                                                                                     |
| [#259](https://github.com/njvil/surevax-cms-revamp/pull/259) | Clinical Orders "Administered" tab — date-scoped log of `clinical_orders` where `completed_at::date = scoped_date`. Worker discovered DB uses `completed_at` (not `administered_at`).                                                                                                                                                                                                                                 |
| [#264](https://github.com/njvil/surevax-cms-revamp/pull/264) | Inventory "Today's movements" card above the Lots table. Date scope picker, sticky-header table, direction badge. Backend `GET /api/inventory/movements?date=YYYY-MM-DD`; `X-Day-Totals` header carries `{count, byDirection}`. `movement_type` mapped to direction: `In→in`, `Out`/`Expire→out`, others→`adjust`.                                                                                                    |
| [#263](https://github.com/njvil/surevax-cms-revamp/pull/263) | Cash drawer open/close UI in BranchKiosk. `GET /api/cash-drawer/current`, `POST /api/cash-drawer/open`, `POST /api/cash-drawer/close`. Server-computed expected total = opening float + Cash payments since `opened_at`. Discovered DB CHECK constraint: drawer ID format is `USR-….CSH-…` (child ID), not `yearId('CDS')` — adapted to `childId(userId, 'CSH')`.                                                     |
| [#267](https://github.com/njvil/surevax-cms-revamp/pull/267) | Branch session day-awareness UI (Branch role only): (1) `BranchDayBanner` thin strip above every page; (2) `BranchDayOpenPrompt` AlertDialog auto-opens once per session-day on `/branch/kiosk` if no drawer is open; (3) day-close warning intercepts logout if drawer open or unsettled transactions; (4) cross-midnight toast on 60s interval when `drawer.openedAt < today`.                                      |
| [#265](https://github.com/njvil/surevax-cms-revamp/pull/265) | Day Summary "Close day" snapshot — sticky footer with Email / Download / Close day. Close → AlertDialog → `POST /api/day-summary/snapshot` upserts a `day_summary_snapshots` row. Drizzle migration `0009`, prefix `DSS`, unique on `(tenant, branch, snapshot_date)` so re-snapshotting overwrites. Email/Download stubs are deliberately disabled with "Coming soon — wiring deferred" tooltips per user direction. |

### UX papercut sweep + search-first records browse

| PR                                                           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#258](https://github.com/njvil/surevax-cms-revamp/pull/258) | **Wave A** — `window.confirm` → `AlertDialog` in NotificationTemplatesPage; missing `onError` toast on AppointmentsPage create; 250ms debounce on TransactionsPage search; new `lib/apiErrors.ts` helper (maps `ApiError.code` + 4xx/5xx classes → friendly copy); `formatPhpAmount`/`DASH` consolidation in `lib/format.ts`; locale fixes (en-PH); BranchKiosk override documented as intentional in `apps/frontend/CLAUDE.md`.                                                |
| [#262](https://github.com/njvil/surevax-cms-revamp/pull/262) | Mutation sweep — audited 48 `useMutation` hooks across 16 `api.ts` files. All 48 had `invalidateQueries` already; 19 call-sites needed `apiErrorMessage` adoption. No raw `err.message` toasts remain.                                                                                                                                                                                                                                                                          |
| [#266](https://github.com/njvil/surevax-cms-revamp/pull/266) | PatientsPage migrated from `ResizablePanelGroup` split-pane to right-side `Sheet` drawer. AppointmentsPage was already on Sheet (audit was wrong); only Patients needed migration.                                                                                                                                                                                                                                                                                              |
| [#269](https://github.com/njvil/surevax-cms-revamp/pull/269) | `STATUS_VARIANT` consolidation — `lib/status.ts` exports `TRANSACTION_STATUS_VARIANT`, `ENCOUNTER_STATUS_VARIANT`, `APPOINTMENT_STATUS_VARIANT`, `statusVariant()` helper. Replaces 5 local maps. **Visual change**: PatientDetail now shows Paid → `default` (was `ok`) to match the canonical Transactions page. The inconsistency was the bug.                                                                                                                               |
| [#268](https://github.com/njvil/surevax-cms-revamp/pull/268) | Pattern 24 infra — backend cursor + `X-Total-Count` + `X-Next-Cursor` headers on 5 list endpoints (patients, audit, notifications, approvals, attendance). Cursor scheme: `base64('<timestamp_iso>                                                                                                                                                                                                                                                                              | <id>')`, ordered `(timestamp DESC, id DESC)`. New `apps/frontend/src/lib/useRecentList.ts`— accumulates pages, exposes`loadMore()`/`reset()`, reads headers via raw fetch. Pattern documented in `apps/frontend/docs/PATTERNS.md` §24. |
| [#270](https://github.com/njvil/surevax-cms-revamp/pull/270) | PatientList migrated to `useRecentList<Patient>` — replaces `useInfiniteQuery` + `IntersectionObserver` auto-scroll. Default = recent 50, manual "Load older" button, `X-Total-Count` displayed in header. Step1Identify keeps `useInfiniteQuery` (search-as-you-type, not records browse).                                                                                                                                                                                     |
| [#271](https://github.com/njvil/surevax-cms-revamp/pull/271) | Hotfix — audit endpoint `?q=` 500. The cursor work in #268 added a separate COUNT(\*) query that didn't JOIN the `users` table; with `?q=` the WHERE referenced `users.firstName/lastName` and Postgres raised "missing FROM-clause entry". One-line fix. The integration test `audit.test.ts > GET /api/admin/audit > filters audit logs by user name (q param)` caught it; #268 and #270 shipped with this red because `Backend integration tests` isn't a required CI check. |

## Still open — clean handover

| Item                                 | Scope                                                                                                                                                                                                                                                                                                                  | Approach                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W5b admin page conversions**       | Audit, Notifications, Approvals, Attendance pages → `useRecentList`                                                                                                                                                                                                                                                    | Inline coordinator, ~80 LoC each, ~300 LoC total. PatientList ([#270](https://github.com/njvil/surevax-cms-revamp/pull/270)) is the working template.                |
| **"Yesterday's loose ends" backend** | New `GET /api/day-summary/loose-ends?date=` aggregating yesterday's unsettled transactions + open prior-day drawers + undocumented administrations                                                                                                                                                                     | Single inline pass, ~80 backend + ~30 frontend. The TODO bullets in `BranchDayOpenPrompt` ([#267](https://github.com/njvil/surevax-cms-revamp/pull/267)) consume it. |
| **Acronym tooltips**                 | BIR / SC / PWD / OSCA / FEFO / PEP / ABTC tooltip wraps in form labels                                                                                                                                                                                                                                                 | Inline; many-files-tiny-edits anti-pattern, don't dispatch as a worker.                                                                                              |
| **Raw `<button>` → shadcn Button**   | Audit flagged ~17 sites; most are legitimate raw HTML (clickable list rows with `role="option"`, dropdown items with `onMouseDown` blur control, tiny icon buttons too small for shadcn Button defaults). Genuine targets: ClinicalOrdersPage tab pills (→ shadcn Tabs primitive), InitiateProtocolPage category pills | Inline, ~30 LoC, optional.                                                                                                                                           |
| **Detail-view migration finish**     | AppointmentDetail audit said "embedded view" — turned out to already be a Sheet. PatientDetail shipped in [#266](https://github.com/njvil/surevax-cms-revamp/pull/266). No further work.                                                                                                                               | ✅ Done.                                                                                                                                                             |
| **Stale agent worktrees**            | 8+ locked worktrees from this and prior sessions under `.claude/worktrees/agent-*/`                                                                                                                                                                                                                                    | `git worktree remove --force` on each. Don't run during active orchestrate; safe between sessions.                                                                   |

## Lessons recorded in memory

1. **[Split orchestrate units >500 LoC](.claude/projects/-Users-njvil-Documents-Personal-Projects-surevax-cms-revamp/memory/feedback_orchestrate_500loc_split.md)** — workers stall mid-task on bigger units; coordinator must pre-split into two workers (layer or vertical slice). Confirmed across 3 waves this session: Day Summary worker stalled (~900 LoC), Inventory worker stalled (~400 LoC), Day Close worker stalled (~300 LoC), Search-first browse worker stalled (~700 LoC), UI polish worker stalled (W6 — but that's the next pattern).
2. **Many-files-tiny-edits is a separate failure mode** (now in the same memory file) — audit-style sweeps (mutation hygiene, raw-button replace, acronym tooltips, STATUS_VARIANT consolidation) burn worker budget on traversal even when the diff is small. PR #262 mutation sweep at 2,177 Tok/LoC; the W6 UI polish worker stalled and never reached remote. **Rule: if scope is "across N files" with N > 10 AND per-file diff is small (<20 LoC each), do it inline.** The coordinator can grep once for all sites then apply Edits in a tight loop without re-reading; workers replay the cache prefix on every Read.
3. **Workers should commit early (even WIP)** — runtime reaps no-commit worktrees on stall. Confirmed across multiple stalls this session: workers without commits = no salvage path.
4. **Audit findings can be stale** — multiple findings in the original UI audit were already-fixed (missing `<h1>` on TransactionsPage/ClaimsPage/AppointmentsPage; AppointmentsPage Sheet migration). Verify with one `grep` before dispatching a worker.

## Dev environment notes

- The audit fix ([#271](https://github.com/njvil/surevax-cms-revamp/pull/271)) couldn't be unit-tested locally — `vitest` requires `DATABASE_URL` which isn't set in this worktree. CI on the PR was the verification gate. For future fixes that touch backend integration tests, either symlink the worktree's `.env` or rely on CI feedback.
- `Backend integration tests` is **not a required CI check** in branch protection. PRs can merge with this red. Worth noting: #268 and #270 both merged with the audit `?q=` test red. The `?q=` filter never worked in production until #271 landed.

## File map of session-shipped surfaces

```
apps/backend/
  drizzle/
    0009_day_summary_snapshots.sql      # NEW (#265)
    meta/_journal.json                   # +0009 entry
  src/
    app.ts                               # +/api/day-summary +/api/cash-drawer mounts
    modules/
      cash_drawer/                       # NEW (#263)
      day_summary/                       # NEW (#260, +snapshot in #265)
      inventory/{routes,db}.ts           # +day-scoped movements (#264) + cursor (#268)
      transactions/{routes,db}.ts        # +day-scoped + dayStats (#261)
      admin/audit.ts                     # cursor + X-Total-Count + JOIN-fix (#268, #271)
      admin/approvals.ts                 # cursor + X-Total-Count (#268)
      admin/attendance.ts                # cursor + X-Total-Count (#268)
      notifications/{routes,db}.ts       # cursor + X-Total-Count (#268)
      patients/{routes,db}.ts            # X-Total-Count (#268)
      scheduled_orders/{routes,db}.ts    # +/administered endpoint (#259)
    shared/
      db/schema.ts                       # +daySummarySnapshots (#265)
      utils/displayId.ts                 # +DSS, +CSH prefixes
apps/frontend/
  src/
    App.tsx                              # +/day-summary route
    lib/
      apiErrors.ts                       # NEW (#258)
      status.ts                          # NEW (#269)
      useRecentList.ts                   # NEW (#268)
    shared/
      components/AppShell.tsx            # +Day Summary nav, +day banner, +day-close warning
      lib/format.ts                      # +DASH, +formatPhpAmount, +formatTime polish
    features/
      day-summary/                       # NEW (#260, +snapshot in #265)
      branch/components/
        BranchDayBanner.tsx              # NEW (#267)
        BranchDayOpenPrompt.tsx          # NEW (#267)
        DrawerOpenDialog.tsx             # NEW (#263)
        DrawerCloseDialog.tsx            # NEW (#263)
      patients/
        PatientsPage.tsx                 # ResizablePanel → Sheet (#266)
        components/PatientList.tsx       # useInfiniteQuery → useRecentList (#270)
      transactions/
        TransactionsPage.tsx             # +day-scope picker (#261)
      inventory/
        InventoryPage.tsx                # +Movements card (#264)
        api.ts                           # +useInventoryMovements (#264)
      clinical-orders/
        ClinicalOrdersPage.tsx           # +Administered tab (#259)
docs/
  ai-context/03-FRONTEND-UI-UX.md        # this PR — Patients/Inventory rows updated, Day Summary row added, "Updated" date bumped
  handovers/2026-05-10-search-first-and-day-scope.md  # this file
apps/frontend/docs/PATTERNS.md           # +§24 search-first browse (#268)
```
