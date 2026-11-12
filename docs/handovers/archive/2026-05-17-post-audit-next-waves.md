# Handover: Post-Conformance-Audit Next Waves — 2026-05-17

> Scope-of-work plan derived from the AppSheet → SureVax CMS conformance audit
> completed 2026-05-17. Captures decisions made in a 16-question scoping
> conversation, organized into 4 dependency-ordered waves plus a deferred
> backlog. **No implementation has been started on any item in this doc** —
> this is the brief for the next coordinator session.

---

## 1. Source artifacts

Before starting any wave, re-read these in order. The handover is a planning
document; the source artifacts are the spec.

| Artifact                                                                                                                                                                               | What it gives you                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/audits/2026-05-17-appsheet-conformance/INDEX.md`](../audits/2026-05-17-appsheet-conformance/INDEX.md)                                                                           | **Audit archive index.** Pointers to every source-of-truth file below.                                                                                                                                                                                        |
| [`docs/audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md`](../audits/2026-05-17-appsheet-conformance/SureVaxCMS_Conformance_Checklist.md)                     | The marked-up row-by-row audit. ✅/⚠️/❌/🗑️ status per workflow plus Δ notes citing file:line in this repo. Section 8 contains the pre-migration decisions.                                                                                                   |
| [`docs/audits/2026-05-17-appsheet-conformance/SureVaxCMS_Audit.md`](../audits/2026-05-17-appsheet-conformance/SureVaxCMS_Audit.md)                                                     | The "why" behind each old workflow. Read for context on any ❌ or ⚠️ row.                                                                                                                                                                                     |
| [`docs/audits/2026-05-17-appsheet-conformance/standing-order-rabies-vaccines-2025-09-22.pdf`](../audits/2026-05-17-appsheet-conformance/standing-order-rabies-vaccines-2025-09-22.pdf) | Clinical SOP (2025-09-22) — Animal Bite Center protocols. Page 2-13 = rabies/TT/ATS/RIG; pages 14-16 = appendix (cholera, Hep A/B, HPV, MMR, TDAP, Shingles, Varicella, Flu). All 23 standing-order templates were seeded from this PDF in the prior session. |
| `apps/backend/src/shared/db/seed/standing-orders.ts`                                                                                                                                   | The 23 seeded SOTs. New protocols added here.                                                                                                                                                                                                                 |
| `.claude/rules/gotchas.md`, `patterns.md`, `risks.md`                                                                                                                                  | Non-negotiable conventions. Every wave below must respect these (tenant in WHERE, JSONB stringify, `withTenantTx` GUC pattern, etc.).                                                                                                                         |

## 2. Decisions captured 2026-05-17 (do not re-litigate)

These were resolved interactively. Each is locked unless a new constraint
surfaces; if you find yourself wanting to revisit one, surface it to the user
before changing direction.

| #   | Topic                                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Branch-scoping enforcement                      | **Full RLS on all tenant-scoped tables.** New `app.current_branch_id` GUC, single audit point at the policy layer.                                                                                                                                                                                                                                                                                                         |
| 2   | Inter-branch inventory transfer (Bot 10)        | **Implement with pending-receipt confirmation step.** Source ships → destination has Pending inverse movement → explicit Receive flips to Received.                                                                                                                                                                                                                                                                        |
| 3   | Branch transaction display ID prefix            | **Add branch code:** `TXN-MRK-2026-XXXX` (extends `yearId()` helper).                                                                                                                                                                                                                                                                                                                                                      |
| 4   | `branches.allowAccess` flag                     | **Drop the flag idea.** Use explicit `user_branches` grants for cross-branch visibility. Doc-only change.                                                                                                                                                                                                                                                                                                                  |
| 5   | Health card / patient ID card (Bot 11)          | **Build PDF + client download.** Stub interface for future cloud (R2) upload — no-op for now, nullable FK on patients.                                                                                                                                                                                                                                                                                                     |
| 6   | Pet/biting-animal model                         | **Build as first-class entity.** Re-classified from the audit: the "pet" in AppSheet was the _biting animal's observation record_, not a veterinary patient. Clinically critical for Day 28 PEP omission decision per DOH/WHO SOP.                                                                                                                                                                                         |
| 7   | Bundle fan-out (Bot 9)                          | **Both mechanisms:** SOT for time-series clinical protocols; `service_bundle_items` runtime expansion for single-encounter line-item expansion (lab panels SV01–SV23, intake-day ARV+ATS+ERIG combos, wellness packages).                                                                                                                                                                                                  |
| 8   | Past-3-day unadministered backfill view (V6/S1) | **Add as a tab on `ScheduledOrdersPage`.** ARV PEP late-dose recovery driver.                                                                                                                                                                                                                                                                                                                                              |
| 9   | Admin post-creation overrides                   | **None.** Keep DB-level immutability strict. Corrections via void+refund flow only.                                                                                                                                                                                                                                                                                                                                        |
| 10  | Bulk-delete for patient/immunization            | **Cancel-all-pending-orders endpoint.** Soft-delete via `status=Cancelled`. SuperAdmin-scoped (see #16 below for role rename).                                                                                                                                                                                                                                                                                             |
| 11  | Negative inventory tolerance                    | **Block at FEFO deduct.** Add reservation step + `CHECK (quantity_on_hand >= 0)`. Clear `NO_STOCK` error path.                                                                                                                                                                                                                                                                                                             |
| 12  | Manual-order append                             | **Build as continuity-of-care feature.** Use case: patient takes Dose 1 elsewhere, completes Doses 2–5 here. SuperAdmin/Physician scope, full audit.                                                                                                                                                                                                                                                                       |
| 13  | UX polish — included                            | tel:/sms: links on patient/clinical-order rows. Admin branch detail page.                                                                                                                                                                                                                                                                                                                                                  |
| 14  | UX polish — deferred                            | Red text on positive cash columns. Tagalog (fil-PH) UI strings.                                                                                                                                                                                                                                                                                                                                                            |
| 15  | Payment processor                               | **Stub interface for PayMongo auto-verification.** Non-cash treated as manually-reconciled until the real integration lands (Phase 2 deferred).                                                                                                                                                                                                                                                                            |
| 16  | SuperAdmin role differentiation                 | **Option 1 (rename + split).** Today's `SuperAdmin` is functionally a per-tenant admin (RLS blocks cross-tenant access regardless of role). Rename it to `TenantAdmin` and introduce a new `PlatformAdmin` role that is **not** tenant-bound — separate `platform_users` table, RLS policy bypass via a new `app.is_platform_admin` GUC, separate `/operator/*` UI shell. Slotted into Wave 2 (touches the same RLS work). |
| 17  | Mobile parity                                   | **Web responsive on tablets (current). Defer native.** Audit mobile-specific behavior separately if it becomes a priority.                                                                                                                                                                                                                                                                                                 |
| 18  | Analytics / reports suite                       | **Defer all** (ImmunizationByBrand, DaySummary export, AEFI registry, series-completion outreach). Promote to its own scoping conversation when ready.                                                                                                                                                                                                                                                                     |

---

## 3. Wave 1 — Clinical correctness blockers

**Must land before any clinic onboards.** Each item here is a patient-safety
or workflow-integrity issue.

### 1.1 Biting-animal observation model

Build `bite_incidents` + `animal_observation_followups` as first-class
entities. At intake, capture: species, vaccination status (with vet-doc date),
animal age, exposure category, bite site, observation requirement. Auto-create
a Day-14 followup task. When followup outcome = `AliveHealthy` (or
`DiedNaturally + FAT=Negative`), system auto-cancels the Day 28 dose on the
patient's PEP series. SOP citations to drive the rule logic are on pages 2, 3,
and 9 of the rabies PDF.

_Dependency:_ none. Can ship before Wave 2.
_AI-assisted effort:_ 3–4 days (schema + migration + service layer +
followup task workflow + UI for capture and outcome recording).

### 1.2 Continuity-of-care manual order append

Endpoint + UI for SuperAdmin/Physician to append a `clinical_order` to an
existing or new SOT chain when a patient arrives mid-series from another
clinic. Includes prior-dose-date capture (used as the chain anchor for
downstream recompute). Full audit log per write.

_Dependency:_ none.
_AI-assisted effort:_ 1 day.

### 1.3 Negative inventory hard block

Add FEFO reservation step: lock available_qty, fail with `NO_STOCK` if
deduct would go negative. Postgres `CHECK (quantity_on_hand >= 0)` constraint
as belt-and-suspenders. Update administer flow to surface the error to the
clinician with FEFO alternatives.

_Dependency:_ none.
_AI-assisted effort:_ 1 day.

### 1.4 Cancel-all-pending-orders endpoint

SuperAdmin (post-rename: `TenantAdmin`) endpoint that bulk-sets
`clinical_orders.status = 'Cancelled'` for all Pending rows on a given
patient, with reason captured. Soft-delete policy preserved (no hard
deletes). Replaces AppSheet's `[ADMIN] Delete All Unadministered Immunizations`.

_Dependency:_ none.
_AI-assisted effort:_ 4 hours.

**Wave 1 total: ~6 days elapsed if serial, ~3 days with 3 parallel workers.**

---

## 4. Wave 2 — Multi-branch / multi-tenant readiness

**Must land before 2nd branch or 2nd tenant onboards.** Phase-2 SaaS
prerequisites. Cheap to do now while no production data exists; expensive to
retrofit later.

### 2.1 Full RLS on all tenant-scoped tables

Supplemental SQL migration adding `branch_isolation` RLS policy keyed on
`app.current_branch_id` GUC. Same pattern as existing `tenant_isolation`
policy (`apps/backend/drizzle/0001_extensions_and_rls.sql:483-489`). Admin
escape via policy `OR` clause keyed on the new `app.is_platform_admin` GUC
introduced in 2.2.

`withTenantTx` already sets the branch GUC (see `patterns.md`); the policy
just adds the enforcement.

_Dependency:_ must land same PR as 2.2 (policy `OR` clause references
the platform-admin GUC).
_AI-assisted effort:_ 4–6 hours.

### 2.2 SuperAdmin → TenantAdmin rename + new PlatformAdmin role

Two distinct concerns, two distinct roles:

- **`TenantAdmin`** (formerly `SuperAdmin`) — per-tenant admin. Same
  capabilities as today's `SuperAdmin`. Rename across `userRoleEnum`,
  all `requireRole(...)` call sites (~12 occurrences per grep), seed
  data, JWT issuance, and docs.
- **`PlatformAdmin`** (new) — cross-tenant SaaS operator. Not bound to
  any tenant. Stored in new `platform_users` table (separate from `users`
  to keep clinic-side schema clean). Authenticates via separate
  `/operator/login` endpoint issuing JWTs with no `tenantId` claim.
  RLS bypass via `app.is_platform_admin = 'true'` GUC set during
  `withTenantTx` for platform-admin requests.

Frontend gets a new `/operator/*` shell distinct from `/app/*`. Tenant
picker, cross-tenant dashboard scaffold (no analytics yet — see deferred).
MFA strongly recommended for platform admins (out of scope for this wave;
add as a security follow-up).

_Dependency:_ must land same PR as 2.1.
_AI-assisted effort:_ 1–2 days. The role rename is mechanical; the
`platform_users` + `/operator` shell is the bulk of the work.

### 2.3 Reciprocal inventory transfer with pending-receipt confirmation

New `inventory_transfers` table (replaces the bare `inventory_transfer_id`
column on `inventory_movements`). At ship time: create source movement
(`Completed`) + destination movement (`Pending`). Receiving branch's UI
shows pending receipts; explicit `POST /api/inventory/transfers/:id/receive`
flips destination to `Completed` and triggers FEFO lot-balance update.
Both legs bound by `inventory_transfer_id`.

_Dependency:_ none beyond schema work.
_AI-assisted effort:_ 2 days.

### 2.4 Branch-coded transaction display IDs

Extend `yearId()` helper to take an optional branch code: returns
`TXN-MRK-2026-XXXX` when branch code present, `TXN-2026-XXXX` when not.
Migration backfills branch code into all existing transactions.
Branch code lives on `branches.code` (already a column — verify it's
populated and 3-char-uppercase-enforced).

_Dependency:_ none.
_AI-assisted effort:_ 4–6 hours (mostly migration + display-ID grep).

### 2.5 Doc updates for `allowAccess` decision

No code change. Update `patterns.md` to document the cross-branch
visibility pattern: "Use explicit `user_branches` rows. There is no
`allowAccess` global flag — if a user needs cross-branch visibility, grant
multiple `user_branches` rows."

_Dependency:_ none.
_AI-assisted effort:_ 30 min.

**Wave 2 total: ~3–4 days elapsed if serial, ~1.5–2 days with 2 parallel
workers. 2.1 + 2.2 must ship together; 2.3, 2.4, 2.5 can be independent
workers.**

---

## 5. Wave 3 — Clinical workflow completeness

**Should land within ~1 month of Wave 1.** Not safety blockers but ops will
feel the absence day-to-day.

### 3.1 Bundle fan-out for single-encounter expansion

Runtime expansion of `service_bundle_items` into per-constituent
`clinical_orders` + `transaction_items` at intake. Handles intake-day
ARV+ATS+ERIG trio, lab panels (SV01–SV23 from AppSheet appdoc), wellness
packages. Coexists with SOT for time-series.

Decision needed during implementation: partial-fan-out semantics. If 1 of
3 constituents has no stock — fail the whole bundle, or expand the rest
and surface the gap? Recommend: fail whole bundle, surface the gap, let
the clinician decide.

Documentation gate: which mechanism applies when. Add to `patterns.md`:
"Time-series protocols (multi-day, multi-dose) → SOT. Single-encounter
line-item expansion (lab panels, intake combos) → bundles."

_Dependency:_ Wave 1.1 (biting-animal model influences PEP-intake bundle
composition).
_AI-assisted effort:_ 2–3 days.

### 3.2 Past-3-day unadministered backfill tab

New "Overdue" lane on `ScheduledOrdersPage` filtering Pending orders in
the past 3 days. Drives V6/S1 ARV PEP late-dose recovery. Tab-level only;
cascade auto-recompute (already in `scheduled_orders/dateMath.ts`)
handles re-scheduling once the late dose is administered.

_Dependency:_ none.
_AI-assisted effort:_ 3–4 hours.

### 3.3 Health card PDF (download-only + cloud stub)

Server endpoint generates a patient-summary PDF, streams to the client
for download. Defines a `CloudStorageUploader` interface; stub
implementation is no-op returning `null`. Future R2 integration drops
in as the real adapter without touching call sites. Nullable
`patients.health_card_attachment_id` FK column added now (NULL until
cloud is wired).

_Dependency:_ none.
_AI-assisted effort:_ 1 day (PDF library selection + template + endpoint).

### 3.4 PayMongo stub for non-cash auto-verification

`PaymentVerifier` interface + stub adapter. Webhook handler stubbed to
no-op. Non-cash transaction flows mark `status = 'AwaitingReconciliation'`
and surface in a manual-reconciliation queue (frontend list, ops dashboard).
When PayMongo is wired in Phase 2, the stub becomes the real adapter
without touching call sites. Adapter pattern documented in `patterns.md`.

_Dependency:_ none.
_AI-assisted effort:_ 1 day.

**Wave 3 total: ~5–6 days elapsed serial, ~2–3 days with 3 parallel workers.**

---

## 6. Wave 4 — UX polish

**Frontend-only, ship piecemeal anytime workers have idle slots.**

| Item                                             | Scope                                                                                      | Effort  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------- |
| tel:/sms: links on patient + clinical-order rows | `<a href="tel:{phone}">` / `<a href="sms:{phone}">` actions on list rows. Zero backend.    | 2 hours |
| Admin branch detail page                         | Settings-side branch detail with config, hours, contact, staff roster, transaction prefix. | 4 hours |

---

## 7. Cross-cutting requirements (applied to every wave)

These are non-negotiable per existing repo conventions. Each wave's PRs
must respect them.

- **Doc parity.** Every PR updates the relevant docs in the same change:
  `CLAUDE.md`, `gotchas.md`, `patterns.md`, the conformance checklist, and
  this handover (with progress markers — see §10). Doc drift is the
  dominant silent-bug class per `risks.md`.
- **Tenant + branch in WHERE.** Even with RLS landing in Wave 2, every new
  list query explicitly includes `tenant_id` and (where applicable)
  `branch_id` in the WHERE clause. RLS is the bottom guard; app filter is
  the top guard. See `gotchas.md` "tenant in WHERE" section.
- **Audit trail.** All new endpoints write to `audit_logs` per the
  existing `audit_log_changes()` trigger. Inserts on audited tables must
  wrap in `withTenantTx` per `patterns.md`.
- **JSONB stringify.** Any new `jsonb` column writes go through
  `JSON.stringify()`. Reference `gotchas.md`.
- **Schema↔Zod↔frontend parity.** Build the 4-column field table for
  every new module per `patterns.md` and the `pr-review` skill.
- **Display IDs.** New PKs use `text` + `randomId`/`yearId`/`childId`/
  `codeId` from `displayId.ts`. No UUIDs. Sub-records embed parent IDs
  with `.` separator.
- **Soft delete only.** Clinical/financial data uses `deleted_at` /
  `status='Cancelled'`. No hard deletes.
- **`format:check` before commit.** CI's first step is `prettier --check`;
  a green typecheck is not a green CI. Run `pnpm prettier --write
<files-you-touched>` then `pnpm format:check` before opening every PR.
- **Conventional Commits + Co-Authored-By.** Per `commits.md`.
- **Auto-merge discipline.** Never force-push to a PR with auto-merge
  armed. Disarm → push → re-arm. Per `commits.md`.

## 8. Standing-order template seeding status

Already complete (prior session, 2026-05-17): 23 SOTs seeded from the
Animal Bite Center SOP PDF — see `apps/backend/src/shared/db/seed/standing-orders.ts`.
Roster covers rabies (PEP-IM, PEP-ID, PrEP-IM, PrEP-ID, Booster-IM,
Booster-ID), tetanus (Primary, Booster), passive immunization (ATS, ERIG,
HRIG), and SOP-appendix vaccines (Cholera, HepA, HepB-Standard,
HepB-Accelerated, HPV, MMR, MMR-HighRisk, Tdap-Primary, Tdap-Booster,
Shingles, Varicella, Flu-Annual).

**Not yet seeded:** Pneumococcal (PCV13/PPSV23). Blocked on catalog —
no service entries exist. Add catalog rows first, then the SOT.

**Validation pending:** ops sign-off on day offsets for Hep/TDAP/
Varicella/Shingles before go-live. Day offsets were derived from PDF
appendix; verify against clinic practice.

## 9. Open follow-ups still needing sign-off

These weren't part of the scoping conversation but remain pending from
the original audit. None block any wave from starting.

1. **Bot 1's 3 unconfigured "New step" placeholders** — recommend drop.
   Awaiting app-owner confirmation.
2. **AppSheet → SureVax data migration mapping** — per-row Vaccine →
   product+service / Service → service_catalog / Package → bundle. For
   the eventual production data export. Will be its own scoping
   conversation when migration timing is decided.
3. **Hep/TDAP/Varicella/Shingles SOT offset validation** (§8 above) —
   ops sign-off before go-live.
4. **Pneumococcal catalog entries + SOT** — add PCV13/PPSV23 to service
   catalog, then seed `SOT-PNEUMO-PCV13-PPSV23` (Day 0 PCV13 → Day 365
   PPSV23 for high-risk).
5. **MFA for PlatformAdmin** — Wave 2.2 ships the role without MFA.
   Add as security follow-up before any platform admin handles real
   tenant data.

## 10. Progress markers (update as waves land)

Update this section in the same PR that lands each item. Don't rely on
git log alone — handover docs are the single source of truth for
work-in-progress.

| Item                                | Status                                | PR                                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wave 1**                          |                                       |                                                                                                                                                                                              |
| 1.1 Biting-animal observation model | Shipped                               | [#359](https://github.com/njvil/surevax-cms-revamp/pull/359)                                                                                                                                 |
| 1.2 Continuity-of-care manual order | Shipped                               | [#357](https://github.com/njvil/surevax-cms-revamp/pull/357)                                                                                                                                 |
| 1.3 Negative inventory hard block   | Already in code (pre-Wave 1)          | `CHECK` in [0003_invariants.sql:31](../../apps/backend/drizzle/0003_invariants.sql); `FOR UPDATE` lock + `OUT_OF_STOCK` throw in [fefo.ts](../../apps/backend/src/modules/inventory/fefo.ts) |
| 1.4 Cancel-all-pending-orders       | Shipped                               | [#358](https://github.com/njvil/surevax-cms-revamp/pull/358)                                                                                                                                 |
| **Wave 2**                          |                                       |                                                                                                                                                                                              |
| 2.1 RLS on tenant-scoped tables     | In progress (PR open)                 | [#362](https://github.com/njvil/surevax-cms-revamp/pull/362)                                                                                                                                 |
| 2.2 TenantAdmin/PlatformAdmin split | In progress (PR open)                 | [#362](https://github.com/njvil/surevax-cms-revamp/pull/362)                                                                                                                                 |
| 2.3 Inventory transfer + receipt    | Shipped                               | [#363](https://github.com/njvil/surevax-cms-revamp/pull/363)                                                                                                                                 |
| 2.4 Branch-coded TXN display IDs    | Shipped                               | [#360](https://github.com/njvil/surevax-cms-revamp/pull/360)                                                                                                                                 |
| 2.5 `allowAccess` decision doc      | In progress (PR open, folded in #362) | [#362](https://github.com/njvil/surevax-cms-revamp/pull/362)                                                                                                                                 |
| **Wave 2b (deferred)**              |                                       |                                                                                                                                                                                              |
| 2.2-FE frontend `/operator` shell   | Shipped                               | [#416](https://github.com/njvil/surevax-cms-revamp/pull/416) (scaffold — MFA still TODO)                                                                                                     |
| **Wave 3**                          |                                       |                                                                                                                                                                                              |
| 3.1 Bundle fan-out                  | In progress (PR open)                 | [#417](https://github.com/njvil/surevax-cms-revamp/pull/417)                                                                                                                                 |
| 3.2 Past-3-day backfill tab         | Already shipped (pre-Wave 3)          | Overdue tab + lane mapping in [ScheduledOrdersPage.tsx](../../apps/frontend/src/features/scheduled-orders/ScheduledOrdersPage.tsx)                                                           |
| 3.3 Health card PDF + cloud stub    | Shipped                               | [#414](https://github.com/njvil/surevax-cms-revamp/pull/414)                                                                                                                                 |
| 3.4 PayMongo stub                   | Shipped                               | [#409](https://github.com/njvil/surevax-cms-revamp/pull/409)                                                                                                                                 |
| **Wave 4**                          |                                       |                                                                                                                                                                                              |
| 4.1 tel:/sms: links                 | Shipped                               | [#410](https://github.com/njvil/surevax-cms-revamp/pull/410)                                                                                                                                 |
| 4.2 Branch detail page              | Shipped                               | [#411](https://github.com/njvil/surevax-cms-revamp/pull/411)                                                                                                                                 |
| **Cross-cutting**                   |                                       |                                                                                                                                                                                              |
| Nightly verify_audit_chain worker   | Shipped                               | [#408](https://github.com/njvil/surevax-cms-revamp/pull/408)                                                                                                                                 |
| tenant_counters + branch counter    | Shipped                               | [#413](https://github.com/njvil/surevax-cms-revamp/pull/413) (schema + migration), [#415](https://github.com/njvil/surevax-cms-revamp/pull/415) (consumer)                                   |

## 11. Suggested rough sequencing

- **Sprint 1 (parallel):** Wave 1 items 1.1–1.4 + Wave 2 items 2.1+2.2
  (paired) and 2.3, 2.4. 6 worker units, ~2–3 days elapsed if
  `/orchestrate`d properly per `parallel-work` skill.
- **Sprint 2 (parallel):** Wave 3 items 3.1–3.4. 4 worker units, ~2–3 days.
  3.1 depends on 1.1 (bite-incident model influences PEP-intake bundle
  composition).
- **Sprint 3 (ambient):** Wave 4 polish. Filled into idle worker slots
  anytime.

Per the `parallel-work` skill: hard caps are 6 workers per wave, 3
spine-touching units per wave. Wave 1 + Wave 2 together exceeds the
spine-touching cap (RLS + role rename + new tables all touch schema);
split into two waves if any worker stalls.

## 12. Reading order for the next coordinator

1. This file (top to bottom).
2. The conformance checklist (§1 above) — for the "why" behind each item.
3. `.claude/rules/gotchas.md` + `patterns.md` — non-negotiables.
4. `apps/backend/src/shared/db/schema.ts` — skim only the sections
   touched by your assigned wave.
5. The relevant existing module under `apps/backend/src/modules/` — read
   one canonical pattern (e.g. `scheduled_orders/` for any time-series
   work, `transactions/` for any money work).
6. **Then** start planning.

Do not start without reading 1–3. Do not read 4 in full — it's 70KB.
