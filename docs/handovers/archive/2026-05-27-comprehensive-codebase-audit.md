# Comprehensive Codebase Audit — SureVax CMS

**Date:** 2026-05-27
**Branch reviewed:** `main` @ `93cf6f4` (via worktree `relaxed-hertz-1d909c`)
**Method:** 5 review passes (bug-class scan → workflow-stream tracing → concurrency/DB-layer/modules → clinical-math/security/frontend → notifications/approvals/integrations/infra), followed by a full local verification run.
**Reviewer:** Claude (Opus 4.7), static review + live verification.

> **Status legend:** `VERIFIED` = reviewer read the exact code and confirmed; `EMPIRICAL` = proven against the running seeded DB; `TRACED` = sub-agent traced it in code, not independently re-read; `LATENT` = real in code but currently masked (see notes).

---

## Remediation status (2026-05-28)

All **6 CRITICAL** and all **~24 HIGH** findings resolved across PRs #490–516. All **~30 MEDIUM** findings resolved. Most **LOW** findings resolved; remaining open LOW items after the 2026-05-28 session:

| Finding                                           | Status                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| MONEY-5 · addPayment overpayment                  | ✅ Fixed PR #518                                                    |
| FE-8 · DirtyFormGuard false-positive after submit | ✅ Fixed PR #518                                                    |
| CLIN-1 · DoseCalcPanel frontend wiring            | ✅ Fixed PR #518                                                    |
| DB-6 · dead-code index in 0005                    | Harmless dead code — defer                                          |
| INFRA-6 · Railpack drizzle/ copy                  | Likely handled by Railpack default — verify at first Railway deploy |
| Investigation-first (B34/B38)                     | Needs focused session with browser tooling                          |

---

## Executive summary

The application **builds, typechecks, lints, formats, seeds, and passes its full test suite** (frontend 38 tests, backend 98 integration tests). Every finding below therefore lives in a **logic/runtime path that the existing gate does not exercise** — the green suite does not validate these away; it confirms the bugs are in untested territory.

Approximate tally: **6 critical, ~24 high, ~30 medium, ~20 low.**

### The two findings that matter most (both empirically proven)

1. **AUTH-2 — RLS is effectively disabled for the app connection.** The application DB role `surevax` is `rolsuper=true, rolbypassrls=true`, so `FORCE ROW LEVEL SECURITY` is a no-op. App-level `WHERE tenant_id` is the **only** real tenant boundary — directly contradicting non-negotiable rule #2. Every bare-`db` query that omits a `tenant_id` predicate leaks cross-tenant PHI with no backstop.
2. **INV-2 — Inventory on-hand is structurally broken on a fresh seed.** `inventory_lot_balances` is empty (0 rows) after seed while `inventory_lots` holds 10 lots / 119 units. The UI reads balances (fallback `0`) so every lot shows 0 on hand, and the first administer of any seeded lot underflows the non-negative CHECK (`23514`).

### Defining themes

1. **Check-then-act with no lock or backing constraint** — idempotency, concurrent administer, refresh rotation, cash drawer, payments. Financial + clinical double-writes.
2. **Patient-safety gaps in the rabies core** — FEFO picks expired lots; the weight-based dose calculator does not exist; `doseNumber` is mis-assigned for real intakes; PEP-progress is off-by-one; WHO exposure category never constrains protocol.
3. **Missing/weak authorization** — `/api/audit`, `/api/lab-orders`, `/api/partner-labs` unguarded; approval quorum & self-approval bypassed; attachment presigned-PUT IDOR.
4. **"Modeled but not wired"** — dose calculator, recall→patient notifications, the entire automated notification pipeline, and approval quorum all have schema/flags but no enforcement.
5. **Cash-drawer reconciliation** is broken in several independent ways.

---

## Verification run (2026-05-27)

| Check          | Command                                   | Result                         |
| -------------- | ----------------------------------------- | ------------------------------ |
| Build          | `pnpm --recursive build`                  | ✅ exit 0                      |
| Typecheck      | `pnpm --recursive typecheck`              | ✅ exit 0                      |
| Lint           | `pnpm lint` (eslint `--max-warnings=0`)   | ✅ clean                       |
| Format         | `pnpm format:check` (Prettier)            | ✅ clean                       |
| Frontend tests | `pnpm --filter @surevax/frontend test`    | ✅ 4 files / 38 tests          |
| DB bootstrap   | `pnpm setup` (Docker PG + migrate + seed) | ✅ exit 0, no RLS/audit errors |
| Backend tests  | `pnpm test` (vitest)                      | ✅ 13 files / 98 tests         |

Empirical DB probe (seeded `surevax_relaxed_hertz_1d909c`):

```
inventory_lots:          10 rows, 119 units on hand
inventory_lot_balances:  0 rows        ← UI source of truth
inventory_movements:     0 rows
app role "surevax":      rolsuper=true, rolbypassrls=true
```

---

## CRITICAL

### AUTH-2 · RLS bypassed for the application connection · `EMPIRICAL`

`apps/backend/src/shared/db/index.ts` (connects as role `surevax`). The role is `rolsuper`/`rolbypassrls`, so `FORCE ROW LEVEL SECURITY` (`drizzle/0001_extensions_and_rls.sql:437`) never applies. App-level `WHERE tenant_id` is the sole tenant boundary.
**Impact:** any bare-`db` query missing a `tenant_id` predicate returns cross-tenant rows. The unguarded endpoints (SEC-3/SEC-4/SEC-5) are one missing predicate from a cross-tenant PHI leak.
**Fix:** create a dedicated `NOLOGIN`-derived app role without `BYPASSRLS`/superuser; connect as it. This also surfaces INFRA-1/INFRA-2 (currently masked) so they can be fixed together.

### CONC-1 · Idempotency replay protection is a TOCTOU no-op · `VERIFIED`

`apps/backend/src/shared/middleware/idempotency.ts:125`. The key lookup runs in its own transaction that commits before `next()` writes in a separate `withTenantTx`; `idempotency_key` on `transactions`/`payments`/`clinical_orders` has **no unique index**.
**Failure:** two `POST /api/transactions` with the same key ~20 ms apart both create a full transaction, each allocating its own `branch_seq` and BIR receipt number → duplicate billed sale, duplicate OR.
**Fix:** add a partial unique index on `idempotency_key` and/or claim the key with an `INSERT … ON CONFLICT` inside the same write tx.

### CONC-2 · Concurrent administer double-deducts inventory and double-completes · `VERIFIED`

`apps/backend/src/modules/scheduled_orders/db.ts:880`. The order is read `SELECT … LIMIT 1` (no `FOR UPDATE`); the completing UPDATE increments `rowVersion` (`:1141`) but never uses it as a WHERE guard. The Completed-immutability trigger only fires `WHEN OLD.status='Completed'`, so two concurrent administers both see `Scheduled`.
**Failure:** double-tap / two nurses → two vaccine doses deducted and two consent rows for one administration; recompute runs twice.
**Fix:** `SELECT … FOR UPDATE` on the order, or add `WHERE row_version = $expected` to the UPDATE.

### INV-1 · FEFO picks EXPIRED lots · `VERIFIED`

`apps/backend/src/modules/inventory/fefo.ts:66`. Eligibility filters `is_quarantined=false` + `quantity_on_hand>=qty` but has **no `expiry_date >= CURRENT_DATE`**, and `ORDER BY expiry_date ASC` sorts the most-expired lot first. Same gap in `clinical_orders/bundleFanOut.ts` pre-flight.
**Failure:** a non-quarantined lot expired yesterday is preferentially selected and administered.
**Fix:** add `AND expiry_date >= CURRENT_DATE` to the eligibility query.

### INV-2 · `inventory_lot_balances` never seeded → 0 on-hand + first-administer underflow · `EMPIRICAL`

`apps/backend/src/shared/db/seed/inventory.ts:168` seeds `inventory_lots.quantity_on_hand` directly but inserts no balance/movement rows; the `maintain_lot_balances` trigger (`drizzle/0001_extensions_and_rls.sql:195`) initializes a balance from the movement _delta_. `listInventoryLots` reads `balanceQuantityOnHand` (fallback `'0'`).
**Failure:** inventory UI shows every lot as 0; first administer (delta `-1`) inserts a balance at `-1` → `23514` → `NEGATIVE_INVENTORY` 409.
**Fix:** seed `inventory_lot_balances` from lot on-hand (or seed an initial `Receipt` movement per lot).

### CLIN-1 · Weight-based dose calculator (ERIG/HRIG/HTIG/ATS) does not exist · `VERIFIED`

`apps/backend/src/shared/db/schema.ts:594`, seed `catalog.ts:290`. `requires_dose_calculation=true` on 4 services; **zero consumers** anywhere (no IU/kg/mL math, no UI). Clinicians hand-compute immunoglobulin doses with no guardrail (no max-dose cap, no zero-weight guard).
**Fix:** implement the calculator (IU/kg with per-product ceilings + infiltration/IM split) or formally defer with a documented manual SOP.

---

## HIGH

### Security / authorization

- **SEC-3 · `/api/audit` mounts with no `requireRole`** · `VERIFIED` · `app.ts:257`. Any role (Cashier/Nurse) reads the tenant-wide audit log (`LOGIN_FAILED`, `PERMISSION_CHANGE`, entity IDs). Every other admin/audit router has the guard. **Fix:** `requireRole('TenantAdmin','BranchAdmin')`.
- **SEC-4 · `/api/lab-orders` no `requireRole`** · `VERIFIED` · `app.ts:233`. Any role reads `resultData` PHI and can **write/overwrite results** (`POST /:id/result`) and silence critical alerts (`POST /:id/acknowledge-critical`). **Fix:** mount with clinical-role guard like `/api/fhir`.
- **SEC-5 · `/api/partner-labs` no `requireRole` + `apiConfig` returned unmasked** · `VERIFIED` · `app.ts:234`, `partner_laboratories/db.ts:115`. Any authenticated user reads partner-lab integration credentials in cleartext. **Fix:** role guard + drop/mask `apiConfig` in the API projection.
- **SEC-1 · Attachment presigned-PUT IDOR** · `VERIFIED` · `attachments/routes.ts:211`. `GET /:id/upload-url` checks only tenant+not-deleted, then issues a presigned PUT to the attachment's `storageKey` — any tenant user can overwrite any attachment's bytes (signed consent/lab PDFs); DB hash unchanged so tamper is invisible. **Fix:** ownership/record-link + role check; re-validate hash on re-upload.
- **SEC-2 · Webhook signature verification is a no-op + route unauthenticated** · `VERIFIED` · `payments_verifier/stub.ts:16`, mount `app.ts:182`. `verifyWebhookSignature()` returns `true`; router mounts before CSRF/auth; `NODE_ENV=development` everywhere means `getVerifier()` never fails closed. DB write short-circuited today only by `verifyPayment` returning null. **Fix:** real signature verification before any state change; mount behind a verification gate.

### Clinical

- **CLIN-2 · `doseNumber` set to within-visit `sequence`, not dose ordinal** · `VERIFIED` · `standing_orders/db.ts:393`. IM PEP template's 5 items all have `sequence:1` (`seed/standing-orders.ts:305`), so real IM PEP intake numbers **all five doses `1`**; ID template is `1,2,1,2,…` (site index). Seed-encounters uses `idx+1` (correct), masking it. Poisons `hasBlockingOverdue`, `getPepProgress`, `projectDownstream`. **Fix:** derive `doseNumber` from visit ordinal, not `item.sequence`.
- **CLIN-3 · `getPepProgress` off-by-one** · `VERIFIED` · `patients/db.ts:1101`. `doseMap` keyed by `doseNumber` (1..N) but loop calls `doseMap.get(i)` for `i=0..N-1` — Day-0 dose vanishes, every dose shifts one label, dose N never fetched. With CL2 on real data it collapses to "1/N" forever. **Fix:** key the loop on `i+1` (or normalize doseNumber to 0-based consistently).
- **CLIN-cancel · Day-28 cancellation can cancel a mid-course dose** · `TRACED` · `scheduled_orders/db.ts:1113`. Picks highest _unadministered_ `doseNumber`, not the verified terminal dose. **Fix:** target the actual final template dose; verify intervening doses resolved.

### Money

- **MONEY-1 · Payer/branch contract pricing ignored at sale** · `VERIFIED` · `transactions/db.ts:781`. Price snapshot hardcodes `isNull(branchId)`+`isNull(payerId)`; never calls `resolveServicePrice`. Partner/HMO patients billed full retail. **Fix:** resolve price by `(branch, payer)` precedence at sale time.

### Concurrency / cash

- **CONC-3 · Refresh-token rotation double-spend** · `TRACED` · `auth/routes.ts:145`. Read/check/insert/markReplaced across 3 txns, old row never locked → two parallel replays mint two live tokens, family-reuse detection bypassed. **Fix:** `SELECT … FOR UPDATE` the old token; rotate atomically.
- **CONC-4 · Double-open cash drawer** · `TRACED` · `cash_drawer/db.ts:78`. Check-then-insert, no lock, no partial-unique on `(tenant,user,branch) WHERE state='Open'`. **Fix:** partial unique index + `ON CONFLICT`.
- **CASH-1 · Drawer-close variance sums a never-populated column** · `VERIFIED` · `staff_time_logs/db.ts:337` + `transactions/db.ts:1100`. Close sums `payments.cash_drawer_session_id`, but `addPaymentTx` never sets it → collected always 0 → variance = declared − float. **Fix:** set `cash_drawer_session_id` on payment insert (or sum by branch+time window consistently).
- **CASH-2 · Two divergent drawer-close implementations** · `TRACED` · `cash_drawer/db.ts:187`. The `/api/cash-drawer/close` path sums Cash by `receivedAt >= openedAt` with no upper bound/session link → double-counts across sessions. **Fix:** consolidate to one session-linked reconciliation.
- **SHIFT-1 · `clock-in` has no open-shift guard** · `TRACED` · `staff_time_logs/routes.ts:104`. Double-POST → overlapping shifts + duplicate open drawers; `getActiveShiftRaw` picks one non-deterministically. **Fix:** reject if an un-clocked-out shift exists.

### DB layer

- **DB-1 · `patients_tenant_mrn_uniq` is a FULL unique index** · `VERIFIED` · `drizzle/0000_initial.sql:236` vs `0005_modern_pg.sql:81`. The intended partial (`WHERE deleted_at IS NULL`) is a `CREATE … IF NOT EXISTS` no-op → soft-deleted MRNs can't be reused. **Fix:** drop and recreate as partial.
- **DB-2 · `transaction_items_txn_service_uniq` blocks per-physician multi-line** · `VERIFIED` · `drizzle/0003_invariants.sql:351`. Unique `(tenant, transaction, service)` prevents two same-service lines distinguished by `performed_by_id` (the documented attribution model). **Fix:** include `performed_by_id` in the unique, or drop it.

### Workers

- **WORK-1 · `analyticsRefresh` queries dropped `users.role`** · `VERIFIED` · `workers/analyticsRefresh.ts:103`. Raw SQL `u.role::text` (column dropped in #217) → every tick throws 42703 (swallowed) → analytics rollups never refresh. **Fix:** project role via `userPrimaryRoleSql`/`user_roles` join.

### Infra

- **INFRA-3 · CI jobs have no `needs:` edges** · `TRACED` · `.github/workflows/ci.yml`. `build`/`migrate`/`test` run independently; merge-gating depends entirely on branch-protection listing all three. **Fix:** add job dependencies and ensure all three are required checks.

---

## MEDIUM

### Money / billing

- **MONEY-2 · Refund doesn't reverse `amount_paid` / no offsetting movement** · `TRACED` · `transactions/db.ts:1285`. Cash reconciliation overstated by refunded amount.
- **MONEY-3 · `byMethod` breakdown counts payments of Voided/Refunded txns** · `TRACED` · `day_summary/db.ts:55`, `transactions/db.ts:343`. No status filter on the payment-sum query.
- **MONEY-4 · Dashboard `unsettledTotal` sums `net_amount` not `amount_outstanding`** · `TRACED` · `dashboard/db.ts:61`. AR overstated by partial payments.
- **MONEY-6 · SC/PWD 20% discount skipped on VAT-exempt lines** · `VERIFIED` · `transactions/service.ts:113`. Possible RA 9994/10754 non-compliance — confirm against BIR rules.

### Concurrency

- **CONC-5 · Concurrent `addPayment` same method+reference bypasses dup guard** · `TRACED` · `transactions/db.ts:1077`. No unique on `(transaction, method, reference_number)`.
- **CONC-6 · Webhook reconciliation matches by non-unique `referenceNumber LIMIT 1`** · `TRACED` · `payments_verifier/routes.ts:107`. Non-deterministic row → wrong payment Cleared, audit misattributed.

### DB layer

- **DB-3 · Break-glass `cross_branch_access_grants` not audited** · `TRACED` · `drizzle/0002_audit_and_redaction.sql:161`. Also `patient_tags`, `service_eligible_products`, `service_bundle_items`, `tenant_counters`.
- **DB-4 · `service_eligible_products.service_id` FK is `onDelete: cascade` to a soft-delete lookup** · `TRACED` · `schema.ts:650`. Hard-delete of a catalog row wipes FEFO mappings; convention says `restrict`.

### Modules / access control

- **MOD-1 · `GET /api/shifts/:id` no user/branch scope** · `TRACED` · `shifts/db.ts:242`. Any tenant user reads another staff member's shift via a guessed `TLG_…` id.
- **MOD-2 · `GET /api/staff-time-logs/active?userId=` no role check** · `TRACED` · `staff_time_logs/routes.ts:54`. Any user reads another user's drawer float/declared/variance.
- **MOD-3 · Encounter vitals accept unvalidated strings into numeric** · `TRACED` · `encounters/routes.ts:52`. `temperatureC`/`weightKg`/`heightCm`/`bmi` are `z.string()` with no range — `weightKg:"-5"` stored, feeding any dose calc.

### Error handling / API contract

- **API-1 · `createTransaction` catch leaks raw error + miscodes as 400** · `TRACED` · `transactions/routes.ts:257`. D2 trigger `RAISE EXCEPTION` (23514) sent verbatim (bypasses `EXPOSE_ERRORS`); transient failures become `400 INVALID_REQUEST`.
- **API-2 · `createEncounter`/`createVital`/`createDiagnosis` return 500 on not-found** · `TRACED` · `encounters/routes.ts:141,217,301`. Should be 404/400.
- **API-3 · Inventory cursor pagination keys on `id` while sorting `expiry_date`** · `TRACED` · `inventory/db.ts:118`. Skips/duplicates lots across pages.
- **API-4 · Lot-movements `limit` uncapped** · `TRACED` · `inventory/routes.ts:116`. `?limit=99999999` → unbounded query.
- **API-5 · Transactions list silently drops invalid `patient`/`encounter` filter** · `TRACED` · `transactions/routes.ts:195`. Returns full (tenant-scoped) list instead of 400.
- **API-6 · Appointment PATCH single-bound time-order skips refine** · `TRACED` · `appointments/routes.ts:67`. Can persist end-before-start.

### Workers

- **WORK-2 · `domainEventsPublisher` releases `FOR UPDATE SKIP LOCKED` before processing** · `TRACED` · `workers/domainEventsPublisher.ts:91`. Lock is dead code → overlapping runs double-process → revenue rollups double-count.
- **WORK-3 · Publisher backoff anchored on `occurredAt` + head-of-line stall** · `TRACED` · `domainEventsPublisher.ts:36`. Old failing events retry every poll; a burst at the head starves newer eligible events.
- **WORK-4 · `notificationsDispatcher` per-tenant single transaction** · `TRACED` · `workers/notificationsDispatcher.ts:101`. One aborted row poisons the rest of the batch.
- **WORK-5 · `analyticsConsumer.dateToDateId` uses server-local tz** · `TRACED` · `workers/analyticsConsumer.ts:267`. Early-morning Manila events bucket to the previous day.

### Notifications

- **NOTIF-1 · Automated pipeline is inert end-to-end** · `VERIFIED`(partial) · `workers/domainEventConsumers/notificationConsumer.ts:159`. (a) interpolation regex `\w` can't match dotted `{{patient.firstName}}`; (b) `EVENT_TO_TEMPLATE_CODE` codes don't match seeded codes (`dose_due_d0`, `appointment_reminder_d-1`); (c) no producer supplies `recipientAddress` and consumer never looks up patient contact; (d) dispatcher marks `Sent` without sending.
- **NOTIF-2 · No consent/opt-out gate on outbound PHI messaging** · `TRACED`. `consent_verified_at` never written/checked.
- **NOTIF-3 · `resolveTemplate` ignores channel/language** · `TRACED`. `LIMIT 1`, no `ORDER BY` against a `(code, channel, language)` unique → wrong-channel template.

### Approvals

- **APPR-1 · Quorum (`requiredApprovers`) ignored** · `VERIFIED` · `admin/approvals.ts:290`. First decision finalizes; backs the DPA-purge multi-signer gate.
- **APPR-2 · Self-approval allowed** · `VERIFIED` · `admin/approvals.ts:290`. Requester can approve own request.
- **APPR-3 · `approverRole` not enforced** · `TRACED`. Only the static router `requireRole` applies.
- **APPR-4 · Cross-branch approval** · `TRACED`. Decider's branch not checked against request branch.

### Product recall

- **RECALL-1 · Patient-notification fan-out does not exist** · `TRACED` · `product_recalls/db.ts`. `patient_notification_required` defaults true but no code joins lot→administrations→patients; zero patients contacted.
- **RECALL-2 · NULL-product recall over-broad match** · `TRACED` · `product_recalls/db.ts:213`. Unanchored `ILIKE '%pattern%'`, no branch scope.

### Integrations / FHIR

- **INT-1 · FHIR views lack `security_invoker`** · `TRACED` · `drizzle/0006_fhir_views.sql:16`. RLS holds only via FORCE + non-bypass owner (see AUTH-2 — already bypassed).
- **INT-2 · FHIR `setGUCs` omits `app.current_branch_id`** · `TRACED` · `fhir/db.ts:16`. Branch-scoped clinicians read tenant-wide FHIR PHI.

### Versioning

- **VER-1 · `createTemplateVersion` leaves old version active** · `TRACED` · `standing_orders/db.ts:690`. Both versions appear active; nurses can start a superseded protocol; concurrent creation 500s. (Version _pinning_ of in-flight orders is correct.)

### Frontend

- **FE-ENV-1/2/3 · List pages render empty (envelope mismatch)** · `VERIFIED` · Claims `ClaimsPage.tsx:190`/`claims.ts:225`; Product Recalls `ProductRecallsPage.tsx:80`/`product_recalls/routes.ts:78`; Partner Labs `PartnerLabsPage.tsx:29`/`partner_laboratories/routes.ts:30`. Backends return bare arrays; frontends read `data?.data`. **Fix:** drop the `{data}` type + `.data` unwrap.
- **FE-ENV-4 · Appointment _detail_ renders all-undefined** · `TRACED` · `appointments/api.ts:88` vs `routes.ts:189`. Backend `{data}`, hook reads bare → Cancel button never appears.
- **FE-CACHE-1 · Bundle/stock sale doesn't invalidate inventory/worklist queries** · `TRACED` · `transactions/api.ts:198`. Missing `['inventory']`, `['lab-orders']`, `['scheduledOrders']`, `['clinical-orders']`.
- **FE-1 · Receipt VAT presentation doesn't foot** · `TRACED` · `AcknowledgementReceipt.tsx:234`. Subtotal(gross) + VAT(embedded) > TOTAL(net); not BIR-conformant.
- **FE-2 · "Amount tendered" input re-runs `formatMoney` every keystroke** · `TRACED` · `TransactionsCreatePage.tsx:698`. Decimals un-typeable; mis-tenders.
- **FE-3 · `TenderRail` `useEffect` overwrites manual tender on item change** · `TRACED` · `TenderRail.tsx:58`. Silently zeroes change-due.
- **FE-4 · Patient age year-only + mislabeled "M"** · `TRACED` · `TransactionsCreatePage.tsx:289`. Off-by-up-to-a-year; `34M` reads as months.
- **FE-5 · `datetime-local` AEFI onset sent as naive local string** · `TRACED` · `ReportAdverseEventDialog.tsx:76`. 8-hour PHT drift on a regulatory timestamp.
- **FE-6 · HMO/Corporate payment submits with no payer profile** · `TRACED` · `AddPaymentDialog.tsx:87`. No Zod refine tying `payerId` to method.

### Auth (other)

- **AUTH-1 · Refresh reissues access tokens from stale JWT claims** · `VERIFIED` · `auth/routes.ts:189`. Role/branch/`can_login` revocation not enforced for up to 7 days.
- **AUTH-3 · `branch_isolation` treats `branch_id IS NULL` as visible to all branches** · `TRACED` · `drizzle/0022_rls_hardening.sql:78`.
- **SEC-6 · Attachment `contentType` no allowlist → stored-XSS risk** · `TRACED` · `attachments/routes.ts:72`.
- **SEC-7 · Operator login: no account lockout, MFA optional** · `TRACED` · `auth/operatorRoutes.ts:58`.
- **SEC-8 · Operator login returns access token in JSON body** · `TRACED` · `auth/operatorRoutes.ts:142`.

---

## LOW

- **INV-3 · Transfer receive/cancel double-counts** lots vs balances (two write paths) · `TRACED` · `inventory_transfers/db.ts:477`.
- **INV-4 · Recall lot-matching: SQL `ILIKE` vs JS `includes` disagree; unescaped metachars** · `TRACED` · `product_recalls/db.ts:213,397`.
- **INV-5 · Bundle pre-flight ignores cumulative demand when one product backs multiple constituents** · `TRACED` · `clinical_orders/bundleFanOut.ts:231`.
- **INV-6 · FEFO tiebreak non-deterministic** when `expiry_date`+`received_at` tie (no `id` tiebreaker) · `TRACED` · `fefo.ts:87`.
- **INV-7 · `inventory_transfers` ship path doesn't translate 23514→409** · `TRACED` · `inventory_transfers/db.ts:318`. Raw 500 on race.
- **CLIN-4 · WHO exposure category never constrains protocol selection** · `TRACED` · `arrivals/steps/Step3Protocol.tsx:61`. No Cat III→RIG enforcement.
- **CLIN-5 · `appendExternalDose` doesn't recompute downstream** · `TRACED` · `standing_orders/db.ts:539`.
- **CLIN-6 · `recordOutcomeAndMayCancelDay28` non-atomic** (outcome + cancel in two txns) · `TRACED` · `bite_incidents/service.ts:31`.
- **CLIN-7 · `listAdministeredOrders` ignores `branchId`** · `VERIFIED` · `scheduled_orders/db.ts:250`. Administered-today log commingles all branches.
- **SCHED-1 · `hasBlockingOverdue` subquery disabled when `doseNumber` is NULL** · `VERIFIED` · `scheduled_orders/db.ts:180`. `co2.dose_number < NULL` never true.
- **SCHED-2 · `projectDownstream` index-pairing breaks on soft-deleted sibling / ID 2-site regimens** · `VERIFIED` · `dateMath.ts:75`.
- **SCHED-3 · today/`completed_today`/preview computed in server UTC vs browser Manila** · `VERIFIED` · `scheduled_orders/db.ts:99`, `Step3Protocol.tsx:308`.
- **MONEY-5 · `addPayment` unbounded overpayment, no change/credit ledger** · `TRACED` · `transactions/db.ts:1061`.
- **DB-5 · `day_summary_snapshots` columns carry no FKs** · `TRACED` · `schema.ts:2506`.
- **DB-6 · `users_tenant_email_idx` 0005 recreate is dead code** (gated on a now-false precondition) · `TRACED` · `0005_modern_pg.sql:31`.
- **DB-7 · `set_updated_at` does per-row `information_schema` lookup** (~45 tables, hot path) · `TRACED` · `0001_extensions_and_rls.sql:94`.
- **AUTH-4 · Login lockout `423` vs `401` enables account enumeration** · `TRACED` · `auth/service.ts:186`.
- **AUTH-5 · failed-login audit `userId=0` (phantom FK); operator GUC set to a text display_id** · `TRACED` · `utils/auditLog.ts:111`, `operator/tenants.ts:38`.
- **FE-7 · Cashier clock-in doesn't invalidate `['shift','current']`** · `TRACED` · `shift/api.ts:44`. TenderRail stale ~30s.
- **FE-8 · `DirtyFormGuard` `beforeunload` false-positive after submit** · `TRACED` · `DirtyFormGuard.tsx:54`. (Needs `reset()` before nav at call sites.)
- **FE-9 · Standing-order list & detail share a query-key namespace** · `TRACED` · `standing-orders/api.ts:78`.
- **INT-3 · FHIR Patient `address` element condition vs `text` composition mismatch** · `TRACED` · `0006_fhir_views.sql:54`. `barangay`-only patients lose address.
- **INT-4 · Places autocomplete: no cache/rate-limit** · `TRACED` · `places/routes.ts:84`. Billed-API cost abuse.
- **INFRA-4 · ~14 runtime env vars unvalidated in `env.ts`** · `TRACED` · `WORKERS_ENABLED`, `*_INTERVAL_MS`, `PAYMENT_VERIFIER`, etc. `NaN` interval → tight loop.
- **INFRA-5 · `0019` ships own `BEGIN;/COMMIT;` inside runner's `client.begin()` wrapper** · `TRACED` · atomicity void for that file.
- **INFRA-6 · Railpack runs `dist/migrate.js` resolving `DRIZZLE_DIR` to source `drizzle/`** · `TRACED` · implicit uncopied build dependency.
- **INFRA-7 · Frontend tests exist but no CI job runs them** · `TRACED` · silent rot.

---

## Latent (real in code, currently masked)

- **INFRA-1 · Seed sets `branch_id=''` without `cross_branch_read` after `0022` inverted `branch_isolation`** · `LATENT` · `seed/db.ts:29`. Would fail RLS WITH CHECK on `user_branches` inserts — but the seed connects as the BYPASSRLS superuser (AUTH-2), so it runs clean today. **Bites the moment AUTH-2 is fixed.**
- **INFRA-2 · Seed connection pool not `max:1`** · `LATENT` · `seed/db.ts:13`. Session GUCs may land on a different pooled connection; masked by light serial load + RLS bypass.

> Both are coupled to AUTH-2: fixing the role hardening (the security fix) will surface these, so fix them in the same change.

---

## Cross-cutting root causes

1. **Check-then-act without a lock/constraint:** CONC-1, CONC-2, CONC-3, CONC-4, CONC-5. The repo already has the correct template in `counters.ts` (`FOR UPDATE` + `ON CONFLICT`) and `inventory_transfers/db.ts` (`FOR UPDATE OF t` + re-check).
2. **Seed/runtime drift:** INV-2 and the INFRA-1/2 latent pair are the same class — the seed populates one representation and the runtime/trigger expects another.
3. **Modeled-but-not-wired:** CLIN-1, RECALL-1, NOTIF-1, APPR-1 — schema columns/flags exist with no enforcing code. Tests pass because the enforcement was never asserted.
4. **Authorization assumed at the wrong layer:** AUTH-2 means RLS isn't enforcing; SEC-3/4/5 + MOD-1/2 then become live cross-tenant/cross-user exposures rather than defense-in-depth gaps.

---

## Recommended remediation (three contained PRs)

1. **Security boundary** — demote the app DB role off superuser/`BYPASSRLS` (AUTH-2; fix INFRA-1/2 in the same PR), add `requireRole` to `/api/audit`, `/api/lab-orders`, `/api/partner-labs`, mask `apiConfig`, and the attachment-PUT ownership check (SEC-1/3/4/5).
2. **Patient safety** — FEFO expiry cutoff (INV-1), seed `inventory_lot_balances` (INV-2), the `doseNumber`/`getPepProgress` chain (CLIN-2/3), and the concurrent-administer lock (CONC-2).
3. **Financial integrity** — idempotency unique constraint (CONC-1), cash-drawer reconciliation (CASH-1/2), refund + `byMethod` filters (MONEY-2/3/4).

The clinical dose calculator (CLIN-1), approval quorum (APPR-1/2), and recall fan-out (RECALL-1) are larger "build the missing feature" efforts — track separately as product work.

---

## What was NOT reviewed

- Accessibility (explicitly out of scope).
- Responsive layout and print-CSS rendering correctness.
- Per-page frontend UX beyond the cashier and arrivals flows.
- Load/performance characteristics under real volume (only static N+1 / index gaps noted).

## Verification environment

- Local: macOS, Node v26, pnpm 11.0.8, Docker `surevax-dev-postgres` (postgres:16-alpine).
- Worktree DB `surevax_relaxed_hertz_1d909c`; backend `:3022`, frontend `:5195`.
- All gates run from the worktree at `93cf6f4`.
