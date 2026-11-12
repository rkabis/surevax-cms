# Remaining TODOs — 2026-05-19

> Consolidates the still-pending items from the five 2026-05-17 → 2026-05-19
> handovers that landed before this date. Source handovers were archived to
> [`docs/handovers/archive/`](archive/) once their actionable items were
> either shipped or migrated here.
>
> Pending items only. Anything shipped is in the git log; anything deferred
> indefinitely (Wave D async audit forwarder, Phase 3 anomaly detection,
> AppSheet historical migration tooling) is not repeated here.

---

## 1. Clinical follow-ups needing ops / app-owner sign-off

| Item                                                    | What's needed                                                                                                                                                                    | Blocker                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Bot 1 — 3 unconfigured "New step" placeholders          | Recommend drop; needs app-owner confirmation before removing from the AppSheet → SureVax mapping.                                                                                | App-owner sign-off                                            |
| AppSheet → SureVax data migration mapping               | Per-row Vaccine → product+service / Service → service_catalog / Package → bundle. For the eventual production data export. Will be its own scoping conversation.                 | Migration-timing decision                                     |
| Hep / TDAP / Varicella / Shingles SOT offset validation | Day-offset values in seed need clinical review against the SOP PDF appendix.                                                                                                     | Ops sign-off before go-live                                   |
| Pneumococcal catalog + SOT                              | Add PCV13 / PPSV23 to `service_catalog`; seed `SOT-PNEUMO-PCV13-PPSV23` (Day 0 PCV13 → Day 365 PPSV23 for high-risk patients).                                                   | Ops decision on inclusion + offsets                           |
| Audit-log Wave A leftover emit sites                    | `BREAK_GLASS` emit (needs the break-glass UI), `CONFIG_CHANGE` emit (needs the admin settings UI write path), `AUDIT_ACCESS` emit (needs the admin audit-log viewer read route). | Upstream UI work — do NOT implement emit sites speculatively. |

PERMISSION_CHANGE (user_roles / user_branches mutations) shipped in [#403](https://github.com/njvil/surevax-cms-revamp/pull/403); LOGIN_FAILED + EXPORT + PRINT helpers exist in [`apps/backend/src/shared/utils/auditLog.ts`](../../apps/backend/src/shared/utils/auditLog.ts) and can be wired into call sites as those flows ship.

---

## 2. Seed completeness — PSO + clinical orders + lab orders ✅ already shipped

~~`seedEncounters` creates 15 encounters but soft-skips PSO / clinical_orders / consents / lab_orders.~~

**Verified 2026-05-21:** [`apps/backend/src/shared/db/seed/encounters.ts`](../../apps/backend/src/shared/db/seed/encounters.ts) already creates PSOs from specialty-appropriate templates, fans them out to `clinical_orders` rows, inserts polymorphic informed-consent rows (`scope_ref_type='encounter'`), and returns `clinicalOrdersByKey` for [`seedLabOrders`](../../apps/backend/src/shared/db/seed/lab-orders.ts) to consume. The handover entry pre-dated the seed extension. Removing from the open-items list.

---

## 3. Stale handover refs to sweep ✅ already swept

**Verified 2026-05-21:** the grep ran across `README.md`, `TODO.md`, `docs/`, and `.claude/`. The only actually-stale ref outside `docs/handovers/archive/` was [`docs/audits/2026-05-17-appsheet-conformance/INDEX.md`](../audits/2026-05-17-appsheet-conformance/INDEX.md), repointed in [#421](https://github.com/njvil/surevax-cms-revamp/pull/421). Every other match was already pointing inside `archive/`.

---

## 4. In-browser preview walkthrough ✅ substantially complete 2026-05-21

The walkthrough was driven via the preview MCP across two sessions and shipped fixes for 9 BLOCKER bugs the static gates had missed:

| PR                                                           | Fix                                                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#426](https://github.com/njvil/surevax-cms-revamp/pull/426) | `/api/auth/me` envelope + missing `firstName`/`lastName` + root `TooltipProvider` + Cash KPI thousand-separator                                                                        |
| [#428](https://github.com/njvil/surevax-cms-revamp/pull/428) | DirtyFormGuard `useBlocker` crash (data-router mismatch) + `BranchDayBanner` / `BranchDayOpenPrompt` 404-spamming `/api/cash-drawer/current` for TenantAdmin                           |
| [#429](https://github.com/njvil/surevax-cms-revamp/pull/429) | `RequireAdmin` + `ADMIN_ROLES` accepted `SuperAdmin` only; the Wave 2.2 `TenantAdmin` rename never reached the frontend → every admin route silently redirected admins to `/dashboard` |
| [#430](https://github.com/njvil/surevax-cms-revamp/pull/430) | Lab Orders + Appointments bare-array envelope drift; Lab Orders status filter strings (`'Resulted'`/`'Collected'`) didn't match the DB enum (`ResultReceived`/`Sent`)                  |
| [#431](https://github.com/njvil/surevax-cms-revamp/pull/431) | "Close drawer #Admin User" copy + Inventory KPI "Lots in stock" mislabel                                                                                                               |
| [#432](https://github.com/njvil/surevax-cms-revamp/pull/432) | `/api/admin/notifications` 500 from `sql.append` whitespace bug + command-palette honest placeholder                                                                                   |

### Sections NOT exercised (need real browser / non-MCP)

- **§3 Cash-drawer poll gate** with `Branch` role (current sweep was TenantAdmin only)
- **§6 Lab Sent → ResultReceived** full UI submit flow (verified via curl only)
- **§8 Kiosk PIN keypad + 5-strike lockout** (Branch role + real keypad)
- **§10 R2 binary upload** with a real PDF (needs Cloudflare R2 env wired)
- Cashier / Nurse / Physician **role-walks**
- Tagalog `fil-PH` UI swap, mobile / tablet / dark-mode

### Observations recorded but not fixed

- ~~**Scheduled Orders KPI/list mismatch.**~~ ✅ Shipped 2026-05-21 ([#433](https://github.com/njvil/surevax-cms-revamp/pull/433)) — split into "Ready today" / "Overdue" / "Needs recompute" / "Completed today" so the headline number matches the rendered list.
- ~~**Day Summary "Revenue" counts Voided rows.**~~ ✅ Shipped 2026-05-21 ([#433](https://github.com/njvil/surevax-cms-revamp/pull/433)) — both `day_summary/db.ts` and `transactions/db.ts` `getTransactionDayStats` now `FILTER (WHERE status NOT IN ('Voided','Refunded'))` for Revenue + AR.
- **Command palette placeholder honest, but no patient/order search.** Now reads "Jump to page or action…" (#432); the actual patient-name search isn't wired. Open follow-up.
- **DirtyFormGuard SPA-nav dialog lost** until data-router migration; tab-close still works via `beforeunload`. Open follow-up; see §11 below.

---

## 5. Compliance prep (Track B from 2026-05-18 database-hygiene)

Must land before any live patient data hits production. No urgency today (no live data); runway shrinks once a Phase 2 customer signs.

> **Cross-ref 2026-05-23:** the 360 codebase review ([`2026-05-23-360-codebase-review.md`](2026-05-23-360-codebase-review.md))
> identifies three additional DPA exposures that need to land in this track:
> **H7** (consent revocation has no enforcement gate at clinical-write time),
> **H8** (PHI access log covers 3 URL patterns only), and
> **M13** (`retain_audit_partitions(10)` has no Node-side runner — partition creation is automated, retention is not).
> Plan to fold these into B2/B3 scoping.

### B1. DPA / NPC at-rest encryption decision

Two paths:

- ~~**B1a — Document Railway's at-rest encryption as the SPI control.**~~ **Landed** — see [`docs/compliance/dpa-controls.md`](../compliance/dpa-controls.md). Decision recorded 2026-05-21: Railway-managed AES-256 disk encryption + Cloudflare R2 SSE-S3 adopted as the SPI at-rest control register. Re-evaluation triggers documented in that file.
- **B1b — Column-level encryption via pgcrypto** on PhilHealth ID, government IDs, free-text SOAP notes. Defeats DB-admin "I selected from the table" attack vectors. Breaks search / joins on encrypted columns.

**Recommendation:** B1a now complete; B1b only if compliance posture changes (triggers documented in `dpa-controls.md`).

### B2. Right-to-erasure procedure — scaffolding shipped 2026-05-21 ([#434](https://github.com/njvil/surevax-cms-revamp/pull/434))

Schema already has `deletion_requested_at` + `scheduled_purge_at` on `patients`.

**Shipped (this session):**

- ✅ `purge_patient(p_patient_display_id text, p_dry_run boolean DEFAULT true)` SQL function in [`0018_dpa_purge_function.sql`](../../apps/backend/drizzle/0018_dpa_purge_function.sql). Dry-run returns a 14-leg cascade-impact report (encounters, clinical_orders, lab_orders, consents, patient_allergies/conditions/contacts/external_immunizations/tags, adverse_events, bite_incidents, transactions/payments anonymize counts, notifications, audit_logs).
- ✅ Live-purge path gated server-side: `p_dry_run=false` raises Postgres `0A000 feature_not_supported` with code `DPA_PURGE_NOT_ENABLED`.
- ✅ Admin endpoint [`POST /api/admin/dpa/purge`](../../apps/backend/src/modules/admin/dpa.ts) requires `acknowledgeDryRun: true` literal in the request body (defense-in-depth over the SQL gate). Mounted with `requireRole('TenantAdmin')`. Verified end-to-end against the seeded `PAT_AAAAAAA8`.

**Still required to enable live purge** (separate PR, no urgency until live patient data):

- Nightly worker (`apps/backend/src/workers/dpaPurger/`) that processes `patients` rows where `scheduled_purge_at < now()`.
- Multi-approver workflow via existing `approval_requests` infra.
- R2 attachment cleanup with audit-row insertion (`action='DELETE'`, `metadata.reason='dpa_erasure'`).
- BIR-retention anonymization logic for transactions / payments / claims; honor 10-year clinical-record retention under PH medical-records rules.
- Remove both gates: drop the `RAISE EXCEPTION` block in `purge_patient` AND the `acknowledgeDryRun` literal in the endpoint Zod.

### B3. Backup verification + DR drill

Railway provides daily backups + PITR; no team has actually restored one. Unverified = unknown.

- Document RPO / RTO. Suggested Phase 1 targets: RPO 24h, RTO 8h. Phase 2: RPO 1h, RTO 1h.
- Quarterly restore drill: pick a recent backup, restore to staging DB, run smoke tests, time the operation, document gaps in `docs/runbooks/disaster-recovery.md`.
- Verify WAL retention window covers your RPO target.

**Effort:** ~half day for the first drill, then ongoing quarterly cadence.

### B4. Effective-dated extension to payer_contracts + tag_definitions ✅ shipped 2026-05-21 ([#421](https://github.com/njvil/surevax-cms-revamp/pull/421))

~~`service_prices` has `effective_from` + `effective_to` (good pattern). Mirror on `payer_contracts` and `tag_definitions` so historical price/contract state can be reconstructed after edits.~~

**Verified 2026-05-21:** `payer_contracts` already carried `effective_from` / `effective_to` from the initial schema; only `tag_definitions` needed the columns. Added via supplemental SQL `0015_tag_definitions_effective_dates.sql` (mirrors `service_prices` pattern, backfills `effective_from = created_at::date` for existing rows). Consumers in `apps/backend/src/modules/patients/db.ts` are unchanged — the columns are additive; filter to `effective_to IS NULL OR effective_to > CURRENT_DATE` only when retirement is actually used.

---

## 6. Phase 2 readiness (Track C from 2026-05-18 database-hygiene)

Defer until a concrete Phase-2 customer signs OR observed pressure in Phase 1.

| Item                                              | Trigger                                                                                                        | Effort |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| **C1.** PgBouncer + Railway connection limits     | Concurrent request count > `pool max × instances`. `max:10` already set per pool.                              | ~1 day |
| **C2.** Tenant-aware date boundaries              | A non-Manila tenant onboards (PH-only today). `tenantDateBoundary(tenantId, day)` helper + ~10 endpoint audit. | ~1 day |
| **C3.** Read replica planning                     | Observed query interference between reporting + operational queries.                                           | ~1 day |
| **C4.** Filipino name handling + fuzzy search opt | Clinic staff complain about duplicate-detection or phonetic matching gaps. Don't preempt; talk to ops first.   | ~1 day |

---

## 7. TXN counter integration into transactions ✅ shipped 2026-05-21 ([#424](https://github.com/njvil/surevax-cms-revamp/pull/424))

`tenant_counters` table + `allocateCounter` / `peekCounter` helpers landed in [#413](https://github.com/njvil/surevax-cms-revamp/pull/413) + [#415](https://github.com/njvil/surevax-cms-revamp/pull/415). Picked **option 3** (auxiliary `transactions.branch_seq integer`) as the lowest-disruption integration:

- `transactions.branch_seq` column populated from `allocateCounter` (`counter_kind='TXN'`) inside the existing `createTransaction` `withTenantTx`.
- Distinct from `display_id` (random `TXN_xxx`); reads as "Nth transaction at this branch" for receipt UI and reporting.
- Surfaced in `TransactionDetail` API response and the AcknowledgementReceipt component ("Branch Txn #" line).
- Legacy / seeded rows stay `branch_seq=NULL` by design; backfill deferred until reporting needs the gap closed.

**Option 1 also shipped 2026-05-21 ([#434](https://github.com/njvil/surevax-cms-revamp/pull/434)):**

- ✅ `addPaymentTx` allocates from `tenant_counters` with `counter_kind='BIR_RECEIPT'` (tenant-wide, `branchId: null`) when a payment pushes status to `Paid` AND `receipt_no` is still null.
- Format: 8-digit zero-padded counter value. Column type stays `text` so a BIR-registration migration can revise the format (`YYYY-NNNNNNNN`, OR-series prefix) without schema change.
- Returns the allocated `receiptNo` in `PaymentResult` so the receipt UI surfaces it without a refetch.

**Still deferred:**

- **Option 2 — `transactions.displayId` sequencing.** Backwards-incompatible for existing rows; would overlap with [#360](https://github.com/njvil/surevax-cms-revamp/pull/360)'s branch-coded TXN format. Skip unless the random-suffix format becomes a problem.

---

## 8. AppSheet conformance audit — items shipped + items still open

The full audit lives at [`docs/audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md`](../audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md). After the 2026-05-21 session, the following audit findings flipped to ✅ or were verified as already shipped:

| Finding                                            | Status                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B10 — Reciprocal inventory transfer                | ✅ Already-shipped: explicit ship + receive paths in [`inventory_transfers/db.ts`](../../apps/backend/src/modules/inventory_transfers/db.ts) (paired movements via `inventory_transfer_id`).                                                |
| V6 / S1 — Past-3-days unadministered backfill lane | ✅ Already-shipped: backend `'backfill'` filter mode + frontend "Backfill · 3d" tab.                                                                                                                                                        |
| `[ADMIN] Delete All Unadministered Immunizations`  | ✅ Already-shipped: `POST /api/admin/patients/:patientId/cancel-pending-orders` ([`patientsCancelPending.ts`](../../apps/backend/src/modules/admin/patientsCancelPending.ts)).                                                              |
| Patient `tel:` / `sms:` row actions                | ✅ Already-shipped: `PhoneLink` in [`apps/frontend/src/components/PhoneLink.tsx`](../../apps/frontend/src/components/PhoneLink.tsx) (used in PatientDetail). Row-level on list pages deferred — list responses don't currently carry phone. |
| Negative-inventory CHECK (special-behavior #16)    | ✅ Shipped 2026-05-21 ([#434](https://github.com/njvil/surevax-cms-revamp/pull/434)): `CHECK (quantity_on_hand >= 0)` on both `inventory_lots` and `inventory_lot_balances`. FEFO deduct translates 23514 → 409 `NEGATIVE_INVENTORY`.       |

### Still open from the AppSheet audit

- **B11 — Health card (PDF generation + R2 store).** Needs ops decision: drop the sentinel-string anti-pattern outright, or build proper PDF + R2 + `attachments` FK flow. Patient-card schema column exists (`patients.health_card_attachment_id`).
- **V14 — `ImmunizationByBrand` analytics.** `ReportsPage` is still "Coming soon."
- **A — Other `[ADMIN] *` actions** (Add immunization to linked txn post-Paid, Update dosage details post-administer, Set transaction label). Each needs scoping with ops.
- **Branch-scoping audit** — confirm every list query in `patients/clinical_orders/transactions` passes `branchId` through `withTenantTx` so the RLS `branch_isolation` policy (Wave 2.1) gates at the DB. Deferred until multi-branch tenants actually onboard.

---

## 9. New observations from this session (open follow-ups)

- **Command palette patient/order search.** Placeholder honest after #432 ("Jump to page or action…") but no patient/order search wired. The palette currently only navigates routes.
- **Data-router migration to restore `DirtyFormGuard` SPA-nav prompt.** Migrate `main.tsx` from `<BrowserRouter>` to `createBrowserRouter` + `<RouterProvider>` (~70 routes in App.tsx). Restore the `useBlocker` call in [`DirtyFormGuard.tsx`](../../apps/frontend/src/components/layout/DirtyFormGuard.tsx) for SPA-navigation "Unsaved changes" AlertDialog. Tab close / refresh still works via `beforeunload`. Substantial refactor — own PR with careful regression testing.
- **List-row `tel:` / `sms:` actions on Patients list + Today's Roster.** Requires `contactNumber` in list-response shapes (currently only in detail rail). Audit finding A4 / A8.

---

## 10. Source handovers (archived)

These were the source materials for everything above; all are now in [`docs/handovers/archive/`](archive/) for history:

- `2026-05-17-post-audit-next-waves.md` — original Wave 1–4 plan (all waves shipped 2026-05-18 → 2026-05-19)
- `2026-05-17-preview-walkthrough.md` — 19-PR in-browser walkthrough checklist (referenced in §4 above)
- `2026-05-18-audit-log-redesign.md` — Waves W3 + W-B + W-C shipped; Wave A leftover in §1 above
- `2026-05-18-database-hygiene.md` — Track A shipped; Tracks B + C in §5 + §6 above
- `2026-05-19-id-redesign-aftermath.md` — Items 1 + 4 partial; Items 2 + 3 in §2 above; Item 5 in §1 above
