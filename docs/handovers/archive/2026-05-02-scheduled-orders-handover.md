# Handover · Scheduled Orders mutating endpoints (2026-05-02)

> **Audience:** the engineer (or agent) picking up the deferred items from
> the 2026-04-29 batch and the small product gaps PR #76 surfaced.
> Read top to bottom.

## What just shipped (PR #76)

[surevax-cms-revamp#76](https://github.com/njvil/surevax-cms-revamp/pull/76) — **Workstream A** from the 2026-04-29 deferred-work handover, plus the read-side surface PR #74 was supposed to land but didn't.

### Backend

- `apps/backend/src/modules/inventory/fefo.ts` — `pickAndDeductFefo(tx, { tenantId, branchId, serviceId, clinicalOrderId, userId, qty })`. FEFO with `FOR UPDATE`, SQL-expression decrement, polymorphic `inventory_transactions` row tagged `referenceType='clinical_order'`. Throws `LifecycleError('OUT_OF_STOCK', 409)` when no qualifying lot. Reuse this helper from any future stock-out flow — do not reimplement.
- `apps/backend/src/modules/scheduled_orders/`:
  - `dateMath.ts` — pure `projectDownstream(items, source, siblings, anchor)`. **Critical:** matches siblings ↔ template items by sorted index, not by `sequence` (the seed uses `sequence=1` for every item).
  - `auditWrite.ts` — explicit `audit_logs` insert with `entityType='clinical_orders'`, `entityId=:id`, `action='SCHEDULE_CHANGE'`. Used for no-op recompute (trigger doesn't fire) and reschedule (to capture human reason in `changes.jsonb`).
  - `service.ts` — opens `db.transaction` with the canonical 3-GUC `set_config` and delegates to `db.ts` mutators.
  - `db.ts` — extended with `paymentStatus` join through `transaction_items → transactions`, `?filter=overdue` branch, `getOrderTimeline`, `previewRecompute`, `applyRecomputeTx`, `administerOrderTx`, `rescheduleOrderTx`.
  - `routes.ts` — added `GET /:id/timeline`, `GET /:id/recompute-preview`, `POST /:id/{recompute,administer,reschedule}`.

### Frontend

- `apps/frontend/src/features/scheduled-orders/api.ts` — `ApiError` class with `statusCode + code` so dialogs can branch on `PAYMENT_REQUIRED` / `OUT_OF_STOCK`. New hooks: `useTimeline`, `useRecomputePreview`, `useAdministerScheduledOrder`, `useRescheduleScheduledOrder`, `useRecomputeScheduledOrder`. `DEFAULT_VIS_VERSION` constant exported. **Query keys renamed to camelCase** (`scheduledOrders` / `scheduledOrder`).
- `components/AdministerDialog.tsx` — `<Dialog>` (not `<AlertDialog>` — see Deviations) with consent checkbox + Patient/Guardian Select + read-only VIS version. Surfaces `PAYMENT_REQUIRED` / `OUT_OF_STOCK` 409s as inline destructive `<Alert>`.
- `components/RescheduleDialog.tsx` — date input + reason textarea (min 5 chars).
- `components/ScheduledOrderDetail.tsx` — replaces `MOCK_TIMELINE` and the hardcoded recompute-preview block with live API data; renders payment-gate banner when `paymentStatus !== 'Paid'`; sets `data-blocked="true"` on the disabled administer button.
- `ScheduledOrdersPage.tsx` — Overdue tab now hits `?filter=overdue` and surfaces `overdueCount`.
- `apps/frontend/src/components/ui/select.tsx` — new shadcn Select primitive (built on `@radix-ui/react-select`, already in `package.json`).
- `apps/frontend/src/features/standing-orders/api.ts:163` — invalidation key updated to match the renamed `['scheduledOrders']` queryKey.

### Bugs caught during verification

1. **dateMath position-pairing**: matching by `sequence === doseNumber` collapsed every dose onto offset=0 (seed has `sequence=1` for every item). Fixed by sorting siblings by `doseNumber` and items by `(dayOffset, sequence)` and pairing by index.
2. **Cross-feature query-key drift**: `standing-orders/api.ts:163` was still invalidating the old kebab `['scheduled-orders']` key after the rename. Caught via grep, fixed in the same PR.

## Deferred / known gaps

These items were in scope of the 2026-04-29 handover or surfaced during PR #76's verification but did NOT ship. Pick the top of this list when starting the next session.

### 1. Workstream B — Arrivals wizard atomic-commit consolidation (DEFERRED from 2026-04-29)

**[DONE]**

The atomic endpoint `POST /api/arrivals/atomic` already exists (PR #75). Today the wizard creates the encounter in Step 2 and the PSO in Step 3 separately, so the atomic endpoint can't be called without producing a duplicate encounter. The cleanup:

- `apps/frontend/src/features/arrivals/steps/Step2Encounter.tsx` must stop POSTing to `/api/encounters` on submit; instead store the encounter draft in `ArrivalContext` and pass through to Step 3.
- `Step3Protocol.tsx` calls `useArrivalAtomicCommit()` (already imported but unused) with the combined Step-2 + Step-3 payload. The `tryUseCreateStandingOrder` import + sibling-hooks consumer can be deleted from Step 3.
- Verify the wizard back-button still works without orphan rows.
- Confirm Step 2 form validation still runs client-side; only the network write moves.

Frontend-heavy with a few backend trims. No new endpoints, no schema changes. See the original 2026-04-29 handover for full details — this remains the source of truth for the work.

### 2. `consent_records.encounterId NOT NULL` — silent skip on non-encounter administer

**[DONE]**

`POST /:id/administer` silently skips the consent-record insert when the source clinical_order has no `encounterId`. All seeded PSO orders have one, so smoke tests pass — but a real-world non-encounter administration would complete with no consent on file.

**Fix options (pick one):**

- **Migration**: relax `consent_records.encounterId` to nullable. Smallest change. Aligns with the reality that not every administered dose ties to a fresh encounter (e.g. a recurring annual flu booster might not).
- **Resolve at administer time**: derive an `encounterId` from the linked PSO's `initiatingEncounterId` (every PSO has one — `patient_standing_orders.initiating_encounter_id`). This keeps the FK and is probably the right answer for Phase 1.

Either fix should also remove the silent-skip — administer should refuse with a typed `LifecycleError('Encounter required for consent', 'CONSENT_BLOCKED', 409)` if neither path resolves.

### 3. Hardcoded `Dr. P. Lim` byline in ScheduledOrderDetail

**[DONE]**

`apps/frontend/src/features/scheduled-orders/components/ScheduledOrderDetail.tsx` still shows "Authorized by Dr. P. Lim · single-transaction commit" as a hardcoded string. There's no `useMe()` hook in the frontend yet — adding one (or re-using the `useAuth().user` from `features/auth/context.tsx`) and rendering the current physician's name closes this.

Out of scope for #76; small follow-up.

### 4. AlertDialog primitive missing

`AdministerDialog` uses `<Dialog>` with destructive copy because `@radix-ui/react-alert-dialog` isn't in `apps/frontend/package.json`. UX is equivalent. If we want the proper `<AlertDialog>` confirm-affordance (focus trap on Cancel by default, etc.), add the package and create `apps/frontend/src/components/ui/alert-dialog.tsx` following the same shadcn pattern as `dialog.tsx`.

### 5. `transaction_items.clinical_order_id` not seeded

**[DONE]**

The seed has 18 transaction_items but zero link clinical_orders. To smoke-test the administer happy path locally, you have to manually `INSERT INTO transaction_items` with a tenant GUC set. **Either** extend the seed to link some Paid transactions to Scheduled clinical_orders (preferred — matches the handover narrative of "patient pays at front desk, then nurse administers"), **or** rewrite the cashier-create flow to set `clinical_order_id` when an item is sold against a known order.

### 6. `projectScheduledDate` not extracted to a shared helper

`standing_orders/db.ts` does its own `startDate + dayOffset` math when generating the initial chain. `scheduled_orders/dateMath.ts` does its own re-projection math when recomputing. They share the same conceptual operation. If a third caller emerges, extract a single helper (`packages/shared/src/utils/scheduling.ts` is the natural home) — but until then, two short call sites is cheaper than the abstraction.

## Conventions for the next session

Read these before coding:

- [`.claude/rules/gotchas.md`](../../.claude/rules/gotchas.md) — now includes audit_logs `entityType/entityId` columns, the FEFO helper location, and the dateMath position-pairing pattern
- [`.claude/rules/patterns.md`](../../.claude/rules/patterns.md)
- [`.claude/rules/commits.md`](../../.claude/rules/commits.md)
- [`.claude/rules/efficiency.md`](../../.claude/rules/efficiency.md)

**Curl smokes are mandatory**. Typecheck + build will pass on data-shape bugs (the seed's `sequence=1` collapse, query-key string drift across features). Run the verification recipe from your plan against the seeded local DB before commit.

**For browser walks via preview tools**: never `window.location.href` between authenticated pages — the full reload races the React auth context. Click an in-app `<a>` link instead.

**For network debugging**: always pass `preview_network` a `urlPattern:"/api/"` or `filter:"failed"`. Unfiltered dumps hundreds of static-asset 200 OKs.
