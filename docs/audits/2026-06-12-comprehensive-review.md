# Comprehensive Code Review — 2026-06-12

Six parallel review agents: security audit, DB schema/performance, RBAC + persona
analysis, live UI/UX walkthrough (full seeded stack, 1440×900 + 2560×1330, TenantAdmin +
Branch kiosk personas), backend quality/contract parity, frontend quality. Findings below
are verified against code (file:line) and, where marked **[live-confirmed]**, reproduced
in the running app.

---

## Executive summary

The infrastructure security layer is genuinely strong (RLS via non-BYPASSRLS role,
parameterized queries everywhere, locked Helmet/CSP/CORS, refresh-token rotation with
reuse detection, fail-closed env guards, CSRF, audit/immutability triggers). The schema
is structurally healthy (timestamptz everywhere, NUMERIC money, keyset pagination, no
OFFSET, partitioned audit_logs). The design system is visibly enforced and consistent.

The problems cluster in four themes:

1. **Money correctness is broken in multiple, compounding places** — the cashier tender
   rail commits "₱0.00" while booking real AR; the backend pre-formats money with comma
   grouping that the frontend then parses as NaN/4; the OR number never prints on
   receipts; the analytics revenue rollup double-counts; Day-0 payment 409s for every
   2-site ID protocol.
2. **The RBAC enum is mostly decorative.** Outside `/api/admin/*`, nearly everything is
   auth-only: any role can administer doses, void/refund transactions, and edit
   catalog prices — and a BranchAdmin can mint a TenantAdmin.
3. **The bare-read-under-FORCE-RLS bug class survived the 2026-06-04 sweep** — the admin
   Users/Branches/Audit pages are nonfunctional (render empty) in a seeded tenant
   [live-confirmed], `/api/audit/recent` returns nothing, and encounters silently
   mis-attributes `recordedById`.
4. **The same fact is computed differently on different surfaces** — KPI strips
   contradict their own tables (Lab Orders/Appointments show all-zero stats over
   populated lists), the dashboard and inventory disagree on expiring lots, the kiosk
   says "no drawer open" and "drawer already open" on the same screen, and "today" is
   not pinned to Asia/Manila.

### Top 10 priorities (cross-dimension)

| #   | Finding                                                                                                                                                 | Dimension       | Severity     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------ |
| 1   | Cashier tender rail stuck at ₱0.00 — commits false "settled" while booking AR                                                                           | UX + FE         | **Critical** |
| 2   | Money contract corruption: backend `formatMoney` in `listTransactions` → frontend `Number("4,820.00")` = NaN/4 → `—` cells + wrong revenue KPIs ≥₱1,000 | BE + FE         | **Critical** |
| 3   | Admin Users/Branches/Audit pages all render empty (bare reads under FORCE RLS suspected) [live-confirmed]                                               | BE + UX         | **High**     |
| 4   | BranchAdmin can create/promote/password-reset a TenantAdmin (`/api/admin/users` has no caller-vs-target check)                                          | Security + RBAC | **High**     |
| 5   | Arrivals "Collect Day-0 payment" 409s for every 2-site ID protocol (`DUPLICATE_TRANSACTION` from the same-service partial unique) [live-confirmed]      | UX + BE         | **High**     |
| 6   | Flat authorization: any role can administer doses, void/refund, edit service prices, PATCH payer contracts; Cashier reads full PHI                      | RBAC + Security | **High**     |
| 7   | `receiptNo` vs `orNumber` rename drift — OR number never shows on receipt or toast                                                                      | BE parity       | **High**     |
| 8   | Analytics daily-revenue rollup double-counts (TransactionCreated + TransactionPaid both increment)                                                      | BE              | **High**     |
| 9   | Hot-path missing indexes: `clinical_orders.patient_id` (D2 trigger fires per sale) and `payments.transaction_id` (sync trigger seq-scans per payment)   | DB              | **High**     |
| 10  | `InitiateProtocolSheet` UUID regex blocks nurse protocol initiation entirely (validates legacy UUID against `USR_…` display IDs)                        | FE              | **High**     |

---

## 1. Security (agent: aa78b5feb2be52ee7)

Counts: Critical 0 · High 1 · Medium 3 · Low 3.

| ID  | Sev   | Finding                                                                                                                                                          | Where                                                                                 |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| F1  | High  | BranchAdmin can mint/replace TenantAdmin accounts — no caller-vs-target privilege comparison; PATCH also re-hashes any user's password                           | `apps/backend/src/modules/admin/users.ts:284-301,346,376,405,533`; mount `app.ts:274` |
| F2  | Med   | PayMongo webhook HMAC never checks timestamp freshness; no event-id dedup — replayable within the AwaitingReconciliation window                                  | `payments_verifier/stub.ts:54-69`, `routes.ts:40-110`                                 |
| F3  | Med   | Operator login lockout is an in-process `Map` — resets on restart, not shared across replicas; rate limit also in-memory (risks.md H3)                           | `auth/operatorRoutes.ts:59-93`                                                        |
| F4  | Med   | `POST /api/attachments/:id/mark-uploaded` lacks the uploader-ownership check its siblings have — IDOR-in-waiting when finalize becomes stateful                  | `attachments/routes.ts:291-311`                                                       |
| F5  | Low   | Attachment reads tenant-wide, not role/relationship scoped; `storageKey` (internal R2 path) returned to clients                                                  | `attachments/routes.ts:123-188`, `db.ts:74,92-190`                                    |
| F6  | Low\* | `/api/encounters` + `/api/scheduled-orders` PHI writes carry no role gate (Cashier can POST encounters/vitals/administer) — _RBAC agent rates this High; see §2_ | `app.ts:233,245`                                                                      |
| F7  | Low   | `X-Dev-Tenant-Id` header trusted verbatim in any non-prod env (and every deployed env is NODE_ENV=development today)                                             | `shared/middleware/tenant.ts:107-115`                                                 |

Verified clean: SQL injection (all `sql.raw`/`unsafe` sites are server-derived constants),
tenant-in-WHERE discipline on sampled modules, mass assignment (validate() replaces
req.body with parsed output, no `.passthrough()`), secrets, Helmet CSP `default-src
'none'` + HSTS, CORS strict list with wildcard rejected at boot, no
dangerouslySetInnerHTML, no tokens in localStorage, attachment upload validation
(allow-list, 50MB, sanitized tenant-prefixed keys, 15-min presign), refresh-token
rotation + family revocation, bcrypt cost 12.

## 2. Authorization / RBAC + personas (agent: a714a00e5be2efa22)

Structural facts: `requireRole` checks the **single primary role** from
`userPrimaryRoleSql` — multi-role staff lose lower-precedence privileges
(`shared/middleware/requireRole.ts:14-28`, `shared/db/userViews.ts:11-19`). Frontend has
exactly two gates (auth + admin-layout); all non-admin roles see the identical app
(`App.tsx:149-182`, `AppShell.tsx:166,402-406`).

**High:**

- Any role can administer a clinical dose (`scheduled_orders/routes.ts:180` auth-only) —
  clinical-safety + attribution issue.
- Any role can void/refund/add payments (`transactions/routes.ts:392,413,365` only block
  platform admins) — segregation-of-duties gap.
- Cashier reads/writes full clinical PHI (encounters, vitals, diagnoses, charts).
- BranchAdmin → TenantAdmin escalation (same as security F1).

**Medium:**

- Payer-profile pricing/contracts PATCHable by any role (`payer_profiles/routes.ts:67,166,200`).
- Cash drawer open/close + day-summary readable/usable by Nurse/Physician (`cash_drawer/routes.ts:33,62,102`).
- Service catalog create/edit incl. basePrice by any role (`service_catalog/routes.ts:66,104,125`).
- `/api/audit/recent` does a **bare `db.select` outside withTenantTx** → empty under
  FORCE RLS (`audit/routes.ts:~226`); also the in-code comment ("all staff") contradicts
  the admin-only mount.
- Approvals workflow has **no producer** — only seed writes `approval_requests`; the
  ApprovalsPage shows seed rows only.
- Break-glass cross-branch reveal is gated TenantAdmin/BranchAdmin on the API while the
  UI shows the button to everyone — the bedside clinician who needs it gets a 403
  (`patients/routes.ts:793,846`; `PatientDetail.tsx:409-433`).

**Workflows with no UI/API at all:** inventory stock-in/receive/adjust (`/api/inventory`
is entirely read-only — lots exist only via seed); approval-request creation; Reports /
Settings / Cold Chain are ComingSoon stubs.

**Persona verdicts:** Branch kiosk is the one persona the product fits end-to-end
(arrivals → worklist → administer → payment → day summary). Nurse is well served (only
role-tailored dashboard). Cashier is half-built — excluded from some clinical APIs (so
those pages 403-break rather than hide) but allowed to administer/void. Physician lacks
a sign-off worklist. BranchAdmin is over-privileged (sees Users where it can mint
TenantAdmins). Shared-screen kiosk exposes full Records nav with no idle-lock (known
deferred posture, but it's the largest real-world PHI surface).

**Recommendation:** either commit to the flat "Branch does everything" model and remove
the half-applied exclusions, or add mutation-level `requireRole` on administer / void /
refund / service-price / payer-contract and switch `requireRole` to the full
`user_roles` set before any non-kiosk staff logins or tenant #2.

## 3. Database schema & performance (agent: adb75e8c1a776a913)

Key insight: RLS quals are OR-expressions, so they are **row filters, never index access
paths** — queries that lean on RLS instead of an explicit indexed key silently seq-scan.
Two of those sit on the hottest write paths.

**High:**

- `clinical_orders.patient_id` unindexed — the D2 branch-invariant trigger
  (`0003_invariants.sql:457-466`) seq-scans the largest clinical table on **every
  transaction INSERT**; also hit by the patients-list per-row PEP subqueries.
- `payments.transaction_id` has no leading-column index — `sync_transaction_amounts`
  seq-scans payments on **every payment write** (`0001:256-258`; the existing index
  leads with tenant_id, which the trigger predicate lacks).
- `domain_events`: poll has no usable index (`workers/domainEventsPublisher.ts:129-141`),
  table grows forever, **no retention proc**, RESTRICTIVE no-delete policy blocks
  cleanup.
- Patients list sort/cursor `(tenant_id, created_at DESC, id DESC) WHERE deleted_at IS
NULL` unindexed; transactions list `(tenant_id, transacted_at DESC)` unindexed.

**Medium:** encounters `(tenant_id, started_at)`, appointments
`(tenant_id, scheduled_start_at)`, audit_logs `(tenant_id, timestamp)`,
`encounter_vitals.encounter_id`, `payments.funded_by_transaction_id` (patient-credit
derivation), `transactions.encounter_id`, patient search ILIKEs bypass both existing GIN
search indexes (pure write overhead today), `phi_access_log (tenant_id, timestamp)` for
the retention DELETE.

**Query-shape problems (no DDL fixes):**

- `listScheduledOrders` has **no LIMIT at all** and runs 3 correlated subqueries per row
  (`scheduled_orders/db.ts:149-207`); `listTransactions` is unbounded when `?limit`
  absent (`transactions/routes.ts:220-221`).
- ~14 non-sargable `transacted_at::date = $1` predicates across transactions/day_summary
  force full tenant scans and are TZ-ambiguous — rewrite as half-open ranges.
- `getTransactionStats` / `getScheduledOrdersStats` aggregate the entire tenant history
  with FILTER clauses on every page load.
- Dashboard `getDashboardStats` runs ~8 queries sequentially and selects DISTINCT
  encounter_id from all clinical_orders ever (no date scope).
- RLS `current_setting()` calls not wrapped in `(SELECT ...)` — re-evaluated per row
  (~6 calls/row on seq-scan-heavy aggregates); wrap for initplan caching.

**Redundant indexes (drop candidates):** `patients_tenant_idx`,
`clinical_orders_tenant_so_idx`, `transactions_active_idx`,
`service_catalog_active_idx`, several tiny `(tenant_id)` ⊂ `(tenant_id, id)` pairs.

Top-10 DDL list with exact `CREATE INDEX CONCURRENTLY` statements is in the agent
report (§Top-10) — all additive, nothing needs redesign. Verified well-indexed: FEFO
pick, scheduled-doses worklist, all display_id lookups, transaction sidecars,
notifications dispatcher, audit_logs partitioning + double-covered retention.

## 4. Backend quality & contract parity (agent: a3c13c2ec7f6091dc)

**Parity verdicts (worst → best):** transactions (2 user-visible bugs) → inventory →
patients ≈ encounters → arrivals → scheduled_orders (clean modulo bigint leaks).

**High:**

- `listTransactions` pre-formats money via backend `formatMoney` → `"4,820.00"`; the
  frontend's `formatMoney` does `Number()` → NaN → `—` cells, and `toCents` does
  `parseFloat` → **4** → today-revenue KPIs wrong for any amount ≥₱1,000
  (`transactions/db.ts:284-286,399-402`; `TransactionsPage.tsx:207-214,626`). Detail
  endpoint returns raw strings — inconsistent contract. Fix: never format in the DB layer.
- `receiptNo` (backend) vs `orNumber` (frontend) — OR number never prints on the
  acknowledgement receipt or success toast (`transactions/routes.ts:296`, `db.ts:574`;
  `AcknowledgementReceipt.tsx:105,115`).
- Inventory list returns quantities as strings while the frontend types them `number`
  and `stockBadge` uses `qty === 0` strict equality — "Out of stock" badge unreachable
  (`inventory/db.ts:287,292`; `InventoryPage.tsx:84-91`).
- Analytics rollup double-counts daily branch revenue — TransactionCreated AND
  TransactionPaid both increment; the fact table dedupes but the rollup doesn't
  (`workers/domainEventConsumers/analyticsConsumer.ts:150-165`, confirmed real).

**Medium:**

- `encounters/routes.ts:294-302` — `recordedById` lookup is a **bare db.select outside
  withTenantTx** → 0 rows under FORCE RLS → silently attributes vitals to the current
  user (same class as the fixed arrivals/atomic bug).
- Patients PATCH silently discards `allergies`/`conditions` that the edit form submits
  (`patients/routes.ts:195-201`; `PatientForm.tsx:322-323`) — silent data loss.
- Arrivals preview validates `patientWeight`/`triageCategory` then never passes them to
  `previewBundle` (ERIG preview ignores weight); `startDate` format unvalidated.
- Error handling: arrivals catch-all leaks raw `err.message` to clients with no
  `logger.error` (`arrivals/routes.ts:305-326`); three bare 500s in notifications
  routes (`:103,134,162`); `idempotency.ts:164` uses console.error in the request path.
- `icd10Code` vs `icdCode` — same conditions, two shapes between `getPatient` embed and
  `/conditions` list.
- Bigint FK leaks in detail projections across transactions, scheduled_orders,
  encounters sub-resources (bare `tx.select()`), inventory, patients header spreads.

**Consolidation:** 25+ private display_id→bigint resolvers (~250 lines deletable);
`LifecycleError` lives in transactions/db.ts but is imported by 10 modules (belongs in
shared/); `sendLifecycleError` duplicated divergently; 21 copies of the YYYY-MM-DD
regex; 84 `(req as Request & {user})` casts → one `getAuthUser(req)` helper.

**Test coverage:** 26 of 35 modules have zero integration/API coverage. Highest-risk
untested: cash_drawer + day_summary (money/EOD), inventory_transfers, standing_orders +
bundle fan-out, lab_orders, scheduled-orders recompute/reschedule date math.

Dead code: `softDeletePatient`, `writeScheduleChangeAuditStandalone`,
`recordFollowupOutcome` wrapper, `moneyOrNull`, dead `pulseBpm` render branch.

## 5. Frontend quality (agent: aeaf7b1e11f0d515e)

**High:**

- `InitiateProtocolSheet.tsx:32,75` — legacy `UUID_RE` validates physician selection
  against `USR_…` Crockford display IDs → `canSubmit` never true → **nurse protocol
  initiation from the encounter sheet is permanently blocked** (the routed page variant
  works). One-line fix.
- Query-key collision: `['branch','physicians']` cached as `{data: [...]}` by
  appointments/branch but as a bare unwrapped array by standing-orders — first fetch
  poisons the other (empty physician dropdowns, silently).
- `useRecentList` (not React Query) means `invalidateQueries(['approvals'])` /
  `(['notifications'])` are no-ops — approved requests stay "Pending" until remount;
  its `reset()` clears rows without refetching.
- Five verbatim local `apiFetch` copies in `features/admin/`
  (approvalsApi/usersApi/partnerLabsApi/attendanceApi/auditApi) — all missing ApiError,
  the single-in-flight refresh dedup (401 races can kill the rotation family), and the
  login redirect.

**Medium:**

- Three prod-breaking relative fetches (no `API_BASE_URL`): `downloadHealthCard`
  (`patients/api.ts:583`) and both attachment-dropzone calls (`:250,275`) — Cloudflare
  Pages doesn't proxy `/api`.
- `/api/shifts/current` cached under both `['shifts','current']` and
  `['shift','current']` — dashboard drawer KPI stays stale after clock-in/out.
- Formatting drift: 60 `toLocale*` sites across 32 files + `'PHP 0'` in DashboardPage
  - `PHP ${...}` in AppShell + two local fmtMoney re-implementations.
- 13 Dialogs missing `DialogDescription`; 6 Title-Case dialog titles (mostly admin).
- Free-text `PAT_…` inputs instead of `<PatientPicker>` in NotificationsPage + ClaimsPage.
- Unbounded lists with no virtualization (transactions, scheduled-orders) — pairs with
  the backend LIMIT findings.
- Hardcoded `SVX` tenant KPI in BranchesPage.

**Low:** 11 inline role-string comparisons (no shared constants/hasRole);
`watch('items')` at TransactionsCreatePage root re-renders the whole cashier page per
keystroke (also implicated in the tender-rail bug); locally re-declared UserRole union.

Verified clean: all 16 list-endpoint envelope unwraps correct (incl. previously-bitten
appointments + lab-orders), zero `as any`, numeric-string discipline, enabled guards,
mutation invalidation in all true React-Query api files, no hardcoded hosts, all 23
feature dirs routed.

## 6. UI/UX — live walkthrough (agent: a9a45c49da42fbeb9)

Full live review on the seeded stack (no static fallback). No ErrorBoundary crashes, no
5xx anywhere. Reviewer TZ = PST vs clinic Asia/Manila — TZ findings flagged.

**Critical/High [all live-confirmed]:**

- **Tender rail stuck at ₱0.00** on `/transactions/new`: line items show correct prices
  but Settle/Subtotal/Due/Change all read ₱0.00 and the enabled commit button says
  "Commit ₱0.00 · unlock administer" — committing booked TXN_TB2T3C4V with net ₱500,
  paid ₱0, outstanding ₱500. Cashier believes they settled; backend books AR. Likely
  the stale `useMemo` over `form.watch('items')` (RHF returns a mutated stable ref).
- **Arrivals Day-0 payment 409s for 2-site ID protocols**: CollectPaymentDialog maps
  each dose to its own `{serviceId, qty:1}` line; the partial unique
  `transaction_items_txn_service_no_physician_uniq` rejects two same-service lines →
  `DUPLICATE_TRANSACTION` with misleading copy and no recovery; patient left registered
  but unbillable via the offered flow. (Single-dose IM path works.)
- **Admin Users / Branches / Audit all render empty** as TenantAdmin in a seeded tenant
  (200 responses, empty arrays, while ≥6 users / HST branch / 21+ audit rows exist) —
  admin area nonfunctional; same bare-read-under-RLS smell as §4.
- **Kiosk open-clinic contradiction**: modal says "no drawer opened today" while the
  same screen's banner says "open since 08:15 AM"; proceeding errors "drawer session
  already open" and dead-ends. Day-boundary (Asia/Manila) disagreement between
  frontend, drawer API, and banner.

**Medium:** transactions day-scoping inconsistent (default day 06/11 while dashboard
says June 12; "Today's transactions" heading regardless of selected day; KPI absorbed a
Jun-12 commit into the 06/11 view); Amount column "—" for most Paid rows; "ACCOUNT
RECEIVABLE ₱2,500 · All settled" contradiction; Lab Orders + Appointments KPI strips all
zeros above populated tables (status-key mismatch); no patient column in Lab Orders;
raw bigints in Appointments (Patient "11", Provider "2") and Inventory Transfers
("1 → 11", Lot "10"); dashboard vs inventory disagree on expiring lots; dashboard
"5 booked" vs Appointments "TODAY 0"; patients-list Schedule column "—" for all 20
rows; patient header "Next dose: due —" while the Standing-order tab says none exist
and the dashboard nudges "Dose 1 due today"; Billing tab "1 unpaid" banner pointing at
a list that only shows a Voided txn; Branch persona dashboard audit card masks a 403 as
an empty state.

**Low (selection):** `/api/health` + `/api/ready` require auth (only bare `/health` is
public — monitoring will false-alarm); toasts persist forever on unfocused kiosk
screens (sonner pauses timers when hidden) and the toaster mounts lazily; "Drawer #12"
hardcoded; `<div>`-in-`<p>` DOM nesting in TransactionDetail audit section (8 hydration
warnings); 4-decimal quantities ("3.0000"); "Dr. A. User" honorific for non-physicians;
em-dashes embedded mid-sentence read as broken copy ("due —", "— into shift");
double `GET /api/auth/me` pre-login.

2560×1330 layout holds cleanly (max-w-screen-2xl cap). Design-system consistency is
strong; the chronic issue is **semantic** (same fact, different answers per surface),
not visual.

---

## Cross-cutting themes & suggested fix waves

**Theme A — Money correctness (fix first, one wave):** tender-rail useMemo bug + stop
backend money formatting + receiptNo/orNumber rename + inventory quantity contract +
analytics rollup double-count + Day-0 same-service 409 (aggregate to qty-2 line or allow
duplicates) + `::date` → half-open ranges + transactions day-scoping pinned to
Asia/Manila. Add integration tests for cash_drawer/day_summary while in there.

**Theme B — Bare-read RLS regression sweep:** admin module reads (Users/Branches/Audit),
`/api/audit/recent`, `encounters recordedById`, and `verify_audit_chain` invocation.
Grep for `db.select`/`db.execute` outside the wrappers and consider extending
`check-bare-db-writes.sh` to flag bare reads in modules/ too — reads are exactly what
FORCE RLS silently empties.

**Theme C — Authorization hardening (decide the model first):** caller-vs-target check
in admin/users (escalation), then mutation-level gates on administer / void / refund /
service-price / payer-contract / cash-drawer, then `requireRole` against the full role
set. Alternatively, explicitly commit to the flat kiosk model and remove the half-built
Cashier exclusions.

**Theme D — Index batch:** the top-10 DDL list (§3) is additive and low-risk; pair with
LIMIT on listScheduledOrders/listTransactions and the stats-query narrowing.

**Theme E — Frontend mechanical sweep:** UUID_RE fix (one line, restores a blocked
clinical flow), physicians query-key split, delete 5 admin apiFetch copies, API_BASE_URL
on the 3 relative fetches, shift key unification, useRecentList refetch, dialog
description/sentence-case sweep, formatting codemod, bigint display leaks (Appointments,
Transfers, Lab Orders patient column).

**Theme F — Semantic consistency:** one source of truth per fact — expiring-lots
definition, overdue counts, "today" (Asia/Manila everywhere), drawer-open state, patient
schedule presence. Fix the Lab Orders/Appointments stats key mismatches.

## Agent references

| Dimension              | Agent ID          | Tokens |
| ---------------------- | ----------------- | ------ |
| Security               | aa78b5feb2be52ee7 | 163k   |
| DB schema/perf         | adb75e8c1a776a913 | 208k   |
| RBAC/personas          | a714a00e5be2efa22 | 164k   |
| Live UI/UX             | a9a45c49da42fbeb9 | 255k   |
| Backend quality/parity | a3c13c2ec7f6091dc | 251k   |
| Frontend quality       | aeaf7b1e11f0d515e | 170k   |
