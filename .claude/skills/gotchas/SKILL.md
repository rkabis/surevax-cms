---
name: gotchas
description: Encyclopedia of low-frequency and single-module SureVax CMS gotchas — cross-site cookies, Drizzle sql template Date serialization, shadcn CLI workaround, JWT secret validation, EXPOSE_ERRORS, pino redact, refresh-token rotation, test credentials, branch-role login, audit_logs column naming, PSO date-math sequence pairing, consent_records.encounterId, Drizzle migration marker surviving partial schema wipes, plus (migrated 2026-08-03) administering-clinician PIN attestation, payer-profile and brand vaccine pricing, patient credit / prepayment, multi-patient transactions, the D2 branch-invariant trigger, the AUTH-2 two-role split and withTenantTx helper trio, SQL template `.append()` whitespace, the TooltipProvider requirement, DirtyFormGuard, and the `/api/auth/me` envelope. Use when touching any of those modules — `.claude/rules/gotchas.md` (always-loaded core) covers high-frequency gotchas only.
---

# Gotchas — Encyclopedia (low-frequency)

Always-loaded core lives at `.claude/rules/gotchas.md`. This skill carries the deep / single-module gotchas. Read the section that matches the module you're editing.

## Cross-site cookies (Cloudflare Pages → Railway)

Cloudflare Pages and Railway are different eTLD+1s. Browsers reject `SameSite=Lax` cookies for cross-site requests, so auth cookies are never stored or sent.

**Fix**: `sameSite: 'none'` + `secure: true` unconditionally in `COOKIE_OPTS` (`apps/backend/src/modules/auth/routes.ts`). Do **not** key `secure` off `NODE_ENV === 'production'` — all Railway envs run `NODE_ENV=development`, so cookies would never be Secure and browsers silently drop `SameSite=None` cookies that aren't Secure.

`apiFetch` already sends `credentials: 'include'` — no frontend change needed.

**Phase 2 hardening**: move to a shared eTLD+1 (e.g. `app.surevax.com` + `api.surevax.com`) so `SameSite=Lax` can be restored.

## `Date` objects in Drizzle `sql` template literals

postgres.js cannot serialize a raw `Date` inside a Drizzle `sql<>` tagged template (e.g. inside aggregate `FILTER (WHERE ...)`). Result:

```
TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type string
or an instance of Buffer or ArrayBuffer. Received an instance of Date
```

**Fix**: call `.toISOString()` before interpolating:

```typescript
// Bad
sql`COUNT(*) FILTER (WHERE ${col} >= ${someDate})`

// Good
sql`COUNT(*) FILTER (WHERE ${col} >= ${someDate.toISOString()})`
```

Drizzle's type-safe operators (`gte`, `lt`, `eq`) handle `Date` objects correctly — only raw `sql<>` templates need this.

## Shadcn/ui CLI

`pnpm dlx shadcn add <component>` fails (can't find pnpm in PATH).

**Workaround**: install Radix peer deps manually with pnpm, then write the component file into `src/components/ui/` using existing components or shadcn/ui source as template.

## Deterministic display IDs in seed

Seed uses fixed display IDs (e.g. `USR_AAAAAAA1`, branch `SVX.HST`, raw catalog codes like `ARVPEP_IM` — see `seed/constants.ts`) so cross-table references work without lookups and re-running is idempotent under `onConflictDoNothing`. Valid alphabet: Crockford base32 (`0-9 A-Z` minus `I L O U`); the `seqSuffix(idx)` helper in `seed/helpers.ts` generates new ones safely. Sub-record ids embed the parent id.

## JWT secrets are required, ≥32 chars

`apps/backend/src/shared/config/env.ts` requires `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (≥32 chars). Backend refuses to boot without them. Both Railway services and local `.env.local` must have them.

Validated alongside `COOKIE_SECRET` and `JWT_SECRET` in the production `looksDev` guard — markers like `dev_`, `change_in_production`, `changeme`, `example`, or any value <32 chars exits with status 1 in production.

## `EXPOSE_ERRORS` for opting into 500-response detail

`apps/backend/src/shared/middleware/error.ts` reads `env.EXPOSE_ERRORS` (not `NODE_ENV`). Default `false`, so 500 responses never include the `detail: String(err)` field.

To debug a 500 in any environment, set `EXPOSE_ERRORS=1`. Full error is always logged via pino regardless. Don't ship `EXPOSE_ERRORS=1` long-term — it's a debugging knob.

## Pino logger redacts secrets — keep it that way

`apps/backend/src/shared/utils/logger.ts` configures pino's `redact: { paths: [...], remove: true }` for `req.headers.cookie`, `req.headers.authorization`, `req.body.password`, `req.body.passwordHash`, `*.passwordHash`, `res.headers["set-cookie"]`. **Don't add log lines that paste `req.body` or `req.headers` raw** — redact is path-based and won't catch new secret-bearing fields you bypass.

## Refresh tokens are persisted + rotated

The `/api/auth/refresh` flow is no longer a stateless JWT verify. As of `0002_legal_vermin.sql` + `0002_refresh_tokens_rls.sql` (security finding #5), every issued refresh token has a row in `refresh_tokens` with `jti`, `family_id`, `expires_at`, `revoked_at`. Rotation happens on every `/refresh`; reuse of a revoked `jti` revokes the entire family and 401s with `code: 'TOKEN_REUSED'`.

Implication: `/logout` revokes the row server-side — a stolen refresh cookie can be killed without rotating the JWT secret.

## Test credentials

| Email                      | Password       | Role       | `can_login` |
| -------------------------- | -------------- | ---------- | ----------- |
| `admin@surevax.com`        | `TestPass123!` | SuperAdmin | true        |
| `branch-main@surevax.com`  | `TestPass123!` | Branch     | true        |
| `juan.dc@surevax.com`      | `TestPass123!` | Nurse      | **false**   |
| `jose.santos@surevax.com`  | `TestPass123!` | Cashier    | **false**   |
| `maria.santos@surevax.com` | `TestPass123!` | Physician  | **false**   |

All belong to the single Phase 1 tenant/branch.

## Branch role + `can_login`

As of 2026-04-26 only **SuperAdmin/BranchAdmin/Branch** rows have `can_login=true` by default. Nurse/Cashier/Physician seed accounts exist as directory entries (clock-in dropdown, "authorized by" picker) and `/api/auth/login` returns 401 for them. Flip `can_login` per user via the admin UI to enable individual clinician login.

Phase 1 shape:

- One `users` row per branch with `role='Branch'` and `can_login=true`.
- Branch sessions use the standard JWT/refresh flow — `req.user.role === 'Branch'` is what kiosk-style endpoints check for.
- `staff_time_logs.clock-in/out` accepts `body.userId` only when the caller is `'Branch'`; otherwise the caller is clocking themselves in.
- `/api/branch/staff` and `/api/branch/physicians` mount with `requireRole('Branch','SuperAdmin','BranchAdmin','Nurse')`. The standing-orders form pulls physicians from this endpoint so Nurse/Branch sessions can populate the "authorized by" dropdown.
- `0003_branch_role_canlogin.sql` flips `can_login=false` for existing Physician/Nurse/Cashier rows. New backend modules creating users must set `canLogin` explicitly.

## `audit_logs` columns are `entityType` / `entityId`

When writing an explicit `audit_logs` row from app code (NOT relying on `audit_log_changes()` trigger), the columns are `entityType` (text) and `entityId` (text), plus `action` (the `auditActionEnum`), `userId`, `tenantId`, and `changes` (jsonb — must be `JSON.stringify`'d).

Canonical writer: `apps/backend/src/modules/scheduled_orders/auditWrite.ts` — `writeScheduleChangeAudit(tx, { tenantId, userId, recordId, action, changes })` translates `recordId` → `entityId` and generates the row id via `yearId('AUD')`.

Explicit insert needed only when the trigger won't fire:

- **No-op UPDATE** (e.g. `/recompute` when date math produces zero shifts).
- **Action-only** semantics where you want `action='SCHEDULE_CHANGE'` to capture `reason` context that isn't a column-level change.

Otherwise let the trigger do it.

## Inventory deduction — two entry points, never hand-rolled

`apps/backend/src/modules/inventory/fefo.ts` exports exactly two deduction
helpers. Pick by whether a human is choosing the brand:

```ts
import { deductLot, pickEarliestExpiringLot } from '../inventory/fefo.js'

// Dose path: the nurse picked the lot (administerBody.lotId).
await deductLot(tx, { tenantId, branchId, serviceId, clinicalOrderId, userId }, 1, lotDisplayId)

// Point-of-sale bundle fan-out only: no clinician in the loop.
await pickEarliestExpiringLot(tx, { tenantId, branchId, serviceId, clinicalOrderId, userId }, qty)
```

`pickAndDeductFefo` is **gone** — a reference to it is stale code. Automatic
earliest-expiry selection for doses was dropped when brand choice moved to the
bedside (the same abstract service can be satisfied by Abhayrab or Speeda, and
that is a clinical decision).

Both share one write half (`applyDeduction`): decrement `quantity_on_hand` via a
SQL expression (never JS arithmetic — `numeric(12,4)` serializes as a string),
then insert an `inventory_movements` row with `movementType='Out'`, a NEGATIVE
`quantity_delta`, and `clinicalOrderId`. `clinical_orders.lot_id` records the
administered lot directly; the movement row is the audit trail.

Differences that matter:

- **Locking.** `pickEarliestExpiringLot` uses `FOR UPDATE … SKIP LOCKED` (there
  is a next-best row to fall back to). `deductLot` uses plain `FOR UPDATE` —
  with a NAMED lot, skipping a merely-locked row would surface a concurrent hold
  as a bogus "out of stock".
- **Refusal codes.** `deductLot` re-validates every guard the picker applied and
  names what failed: `LOT_NOT_FOUND` (404), then `LOT_WRONG_BRANCH`,
  `LOT_QUARANTINED`, `LOT_EXPIRED`, `LOT_NOT_ELIGIBLE`, `LOT_OUT_OF_STOCK` (all
  409). `pickEarliestExpiringLot` throws the single `OUT_OF_STOCK`.
- **Eligibility** comes from `eligibleProductIdsSql` (`modules/inventory/eligibility.ts`)
  in BOTH — the UNION of legacy `service_catalog.product_id` and the
  `service_eligible_products` junction. Never re-inline that subquery: the copy
  in the arrivals preview once drifted and made every abstract service read
  "No lots in stock".

Caller opens the tx with the canonical GUCs (tenant / user / branch) first.

## Brand-specific pricing — `service_prices.product_id`

A picked brand may cost more than the abstract service's base rate. Precedence
in `resolveServicePrice` (`shared/lib/pricing.ts`) is WEIGHTED, not counted:
payer 4 > product 2 > branch 1, so `payer+brand (6) > payer (4) > brand (2) >
base (0)`. A payer contract therefore beats a brand uplift unless an explicit
`(payer_id, product_id)` row exists.

Two traps:

- The `service_prices_no_overlap` EXCLUDE constraint (`0005_modern_pg.sql`)
  MUST include `COALESCE(product_id, 0)`. Without it a brand row is an exclusion
  violation against the brand-agnostic row over the same date range, and a seed
  using `.onConflictDoNothing()` reports success while inserting nothing.
- Any query that LEFT JOINs "the catch-all price row" must filter
  `product_id IS NULL` too, else a service with a priced brand fans out into one
  row per brand (`service_catalog/db.ts` list) or a base-price edit closes every
  brand row (`updateService` rotation).

When the administered brand costs more than an already-billed dose, the bill is
NOT rewritten (Paid transactions are immutable). `administerOrderTx` stamps
`transaction_items.lot_id` and writes an `audit_logs` row —
`action='TRANSACTION_MODIFY'` with `metadata->>'reason' = 'brand_price_variance'`.

## Weight-based dose-calc keys on catalog `code`, resolved from catalog `id` (2026-06-14)

`DOSE_RULES` in `apps/backend/src/shared/utils/doseCalc.ts` is keyed by the
clinical catalog **`code`** (`ERIG_INF | HRIG_INF | HTIG | ATS`), but the
frontend Administer dialog passes the catalog **`id`** (`order.service.id` =
`SVC_ERIG_INF`, etc. — see `ScheduledOrderDetail.tsx`). A raw
`DOSE_RULES[serviceCode]` lookup on the `SVC_`-prefixed id misses and the
`POST /api/dose-calc` route returns 400 `NOT_DOSE_CALCULATED`, which permanently
disables the dialog's "Confirm & administer" button — the dose can never be
given through the UI. Use the exported `resolveDoseRule(serviceIdentifier)` —
it accepts either form (direct hit, then `SVC_`-stripped) — for both the route
gate and inside `calculateDose`. The four dose-calc catalog rows follow
`id === 'SVC_' + code`.

## PSO date-math: pair siblings to template items by index, not by `sequence`

When projecting downstream `clinical_orders.current_scheduled_date` from a source dose (e.g. recompute after administer), do NOT match by `item.sequence === order.doseNumber`.

**Why:** the seed (and most real templates) uses `sequence=1` for every item — `sequence` orders services within a single `day_offset`, not days within a chain. Matching by sequence collapses every dose onto the first item (`day_offset=0`), so `/recompute` returns `updated: 0` even after a Day-N reschedule.

**Correct approach** (canonical: `apps/backend/src/modules/scheduled_orders/dateMath.ts`):

1. Sort siblings by `doseNumber` ASC.
2. Sort template items by `(dayOffset, sequence)` ASC.
3. Pair them by index — sibling[i] ↔ item[i]. Position-in-chain is the stable invariant.
4. `newDate(M) = anchor + (item[M].dayOffset - item[K].dayOffset) days` where K is the source's index, M is each downstream index.

Curl-smoke any new projection helper end-to-end against the seeded DB; typecheck won't catch this collapse.

## `consent_records.encounterId` is NOT NULL — administer skips silently when absent

`POST /api/scheduled-orders/:id/administer` currently **silently skips** the consent-record insert when the source clinical_order has no `encounterId` set, because `consent_records.encounter_id` is `NOT NULL`. All seeded PSO orders have `initiating_encounter_id` so smoke tests pass — but a real-world non-encounter administration would complete with no consent on file.

Two fix options:

- **Migration**: relax `consent_records.encounter_id` to nullable.
- **Resolve at administer time**: derive `encounterId` from the PSO's `initiating_encounter_id` (every PSO has one) and refuse with a typed `LifecycleError('Encounter required for consent', 'CONSENT_BLOCKED', 409)` if neither path resolves.

Either fix should also remove the silent-skip — administer should fail loudly when consent can't be recorded.

## Drizzle migration marker survives `DROP SCHEMA public`

`drizzle-orm`'s migrator tracks applied migrations in `drizzle.__drizzle_migrations` — a **separate schema** from `public`. If anyone wipes only `public` (e.g. a manual `DROP SCHEMA public CASCADE` for a Railway reset), the marker row survives. On the next `db:deploy` drizzle decides `0000_initial.sql` is already applied and silently skips it — but [migrate.ts](../../../apps/backend/src/shared/db/migrate.ts)'s supplemental loop still runs, and `0001_extensions_and_rls.sql` crashes with:

```
type "audit_action" does not exist
```

That's the real symptom; "feature_flags column missing" is the wrong diagnosis. It happened for real on Railway dev from PR #392 (2026-05-18) until 2026-05-23.

**`migrate.ts` now self-heals** — before `drizzle.migrate()` it checks for the drift (drizzle marker populated + `audit_action` enum absent) and `TRUNCATE`s the marker so 0000 re-applies. If you see the self-heal `NOTICE` in deploy logs, that's why.

**When resetting a Postgres DB by hand, always wipe all three schemas:**

```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS analytics CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
```

The `analytics` schema holds the `mv_patient_protocol_completion` materialized view (created by `0001_extensions_and_rls.sql`); skipping it leaves a stale view that the next migration can't replace cleanly either.

---

# Migrated from always-loaded core (2026-08-03)

Migrated out of `.claude/rules/gotchas.md` on 2026-08-03 to keep the always-loaded budget
down. Content unchanged, and re-extracted after rebasing onto main so it
carries main's latest edits to these sections.

## Who administered the dose is PIN-attested, not the login (2026-07-30)

`clinical_orders.administered_by_id` is the clinician who physically gave the
dose; `documented_by_id` is the session that typed it in. On the shared,
day-scoped `Branch` login these are **never the same person**, which is why the
split exists: before it, every dose in the clinic was attributed to the branch
service account, and the legacy AppSheet database records the nurse per dose
(`Immunization.i_NurseRef`), so it was a parity regression too.

`administerBody` carries `administeredById` (`USR_…`) + `attestationPin`
(4 digits, the same kiosk PIN and `pin_attempts` lockout counters clock-in uses).
Rules, enforced in `resolveAdministeringClinician`:

- Caller is a real clinician (`Nurse`/`Physician`/`BranchAdmin`/`TenantAdmin`)
  logged in as themselves → may omit both; the session IS the attestation.
- Caller is a shared login (`Branch`) → both are REQUIRED, else 400
  `ATTESTATION_REQUIRED`.
- The named clinician must be active, hold a clinical role, and be in
  `user_branches` for the caller's branch.

**Resolve it BEFORE opening the transaction.** Verifying a PIN performs its own
writes (the lockout counters), which must not ride on: or be rolled back with ,
the clinical transaction. `administerOrderTx` therefore takes an already-resolved
`administeredById` bigint and never reads the two DTO fields itself.

Refusal codes (all pre-transaction, so no dose was recorded and the nurse-facing
copy says so): `ATTESTATION_REQUIRED`, `ATTESTATION_PIN_REQUIRED`,
`ATTESTATION_PIN_INVALID`, `ATTESTATION_LOCKED_OUT`, `ATTESTATION_NO_PIN_SET`,
`ATTESTATION_USER_UNKNOWN`, `ATTESTATION_ROLE_INVALID`,
`ATTESTATION_WRONG_BRANCH`.

Grep markers + files: `resolveAdministeringClinician`, `attestationPin`,
`ATTESTATION_REQUIRED`, `administeredById` ,
`apps/backend/src/shared/utils/clinicianAttestation.ts`,
`apps/backend/src/modules/scheduled_orders/{contract,service,db}.ts`,
`apps/frontend/src/features/scheduled-orders/components/AdministeredByField.tsx`.

## Payer profiles price a vaccine; the brand rarely does (2026-07-30)

A dose's price resolves on three independent axes and the nurse only picks two:
the SERVICE (chosen when the standing order starts), the BRAND (chosen at the
bedside, `service_prices.product_id`, and priced separately only for Speeda and
the two premium flu brands), and the PAYER (chosen at SETTLEMENT,
`service_prices.payer_id`). Precedence is weighted payer 4 > product 2 > branch 1
(`shared/lib/pricing.ts`), which is why the brand choice never waits on knowing
the payer.

The legacy `Vaccine` sheet buries the payer in `v_Route` alongside the real route
and, on consultation rows, the physician: so one clinical entity fans out to
brand x payer rows (271 rows for what v2 models as ~40 services). Collapsing that
is safe on evidence: **across all 65 (service, payer) combinations in the export,
no two brands ever disagree on the payer price.** Payer tiers, highest first:
`HMO` (card rate) > `HPPI` (anti-rabies line only) > `MedAsia` / `HatiHealth`
(negotiated corporate) > `mWell` (platform uplift on base).

`GET /api/scheduled-orders/:id/doses?payerId=PYR_…` returns each dose's resolved
`unitPrice` for that payer, so the collect picker shows what will actually be
billed instead of the catalog base price.

Grep markers + files: `PAYER_HMO_DISPLAY_ID`, `PARTNER_PRICING`, `dosesQuerySchema`
, `apps/backend/src/shared/db/seed/{catalog,payers,constants}.ts`,
`apps/backend/src/modules/scheduled_orders/db.ts`,
`apps/frontend/src/features/scheduled-orders/components/CollectPaymentDialog.tsx`.
The full note on the three axes is at the top of `seed/catalog.ts`.

## Brand selection is manual at administer time (2026-07-25)

`administerBody.lotId` is **required**: the nurse picks which brand goes into the
patient (`GET /api/scheduled-orders/:id/eligible-lots` lists the candidates,
house-brand-first then earliest-expiry). `pickAndDeductFefo` no longer exists —
`deductLot` deducts the named lot and re-validates tenant/branch/quarantine/
expiry/quantity **and** product eligibility; `pickEarliestExpiringLot` keeps the
automatic pick for point-of-sale bundle fan-out only.

A brand may carry its own price via `service_prices.product_id` (NULL = base /
any brand). Precedence is weighted — payer 4 > product 2 > branch 1 — so a payer
contract outranks a brand uplift unless an explicit `(payer_id, product_id)` row
exists. Lines billing an already-administered dose price the brand
(`resolveAdministeredBrands` in `transactions/db.ts`); lines billed in advance
cannot know the brand, so when the administered brand costs more the bill is left
alone and `administerOrderTx` writes an `audit_logs` row with
`metadata->>'reason' = 'brand_price_variance'`.

The brand column's forward-migration file (`0009_brand_pricing.sql`) was folded
into the baseline and deleted in [#595](https://github.com/njvil/surevax-cms-revamp/pull/595);
the column now ships in `0000_initial.sql`. The rule it existed for still holds:
a baseline edit alone never reaches an existing DB, so any NEW column needs its
own supplemental file (see `patterns.md` migration safety). Live examples of that
pattern today are `0008_payer_price_adjustment.sql` and `0009_payment_void.sql`.

Grep markers + files: `deductLot`, `pickEarliestExpiringLot`,
`eligibleProductIdsSql`, `brand_price_variance` —
`apps/backend/src/modules/inventory/fefo.ts`,
`apps/backend/src/modules/inventory/eligibility.ts`,
`apps/backend/src/shared/lib/pricing.ts`,
`apps/backend/src/modules/scheduled_orders/{contract,db}.ts`,
`apps/frontend/src/components/forms/BrandLotPicker.tsx`. Deep detail (locking
choice, refusal codes, the EXCLUDE-constraint trap) → `gotchas` skill.

## Patient credit / prepayment is a payment row, never a deposit mutation (2026-06-04)

Two ways a patient pays ahead — keep them distinct:

- **Per-dose / per-series prepay (Mechanic A):** a _normal_ transaction
  (`is_prepayment = false`) whose `transaction_items.clinical_order_id` link the
  bill to specific `clinical_orders` (doses), paid in advance (full → `Paid`,
  partial → `Pending` downpayment). No special apply step; the dose's derived
  `paymentStatus` reflects it. Picker data: `getPrepayableDoses`
  (`scheduled_orders/db.ts`) → `GET /api/scheduled-orders/:id/doses`. UI:
  `CollectPaymentDialog`.
- **Free-standing patient credit / deposit (Mechanic B):** an _item-less_
  `is_prepayment = true` transaction whose `net = depositAmount` (the `NO_ITEMS`
  guard in `createTransaction` is relaxed only for this shape; pass
  `depositAmount`). It is **deferred revenue (a liability)** — excluded from all
  revenue/AR aggregates (see `patterns.md`).

**Consuming credit = a `Credit` payment on the consuming txn, NOT a mutation of
the deposit.** `applyPrepayment` (`transactions/db.ts`) inserts a payment
(`method = 'Credit'`, `funded_by_transaction_id = deposit.id`,
`reconciliationStatus = 'Cleared'`, no drawer link) for
`coverage = min(remainingCredit, outstanding)` via the existing `addPaymentTx`
path — so partial coverage → `Pending`, full → `Paid`, and MONEY-5 still caps
overpayment. **Why a payment row and not a balance column on the deposit:** the
deposit is `Paid`, and the immutability trigger (`0004`) forbids writing a
`consumed_amount` back to it. The only deposit mutation allowed is the one-way
`prepayment_applied_at` NULL→timestamp (done once, when exhausted; it
short-circuits the whole UPDATE so `applied_to_transaction_id` rides along).

**Remaining balance is DERIVED, never stored:**
`remaining = deposit.amount_paid − SUM(payments.amount WHERE funded_by_transaction_id = deposit.id)`.
`getPatientCredit` → `GET /api/patients/:id/credit` returns `{ available, deposits[] }`.

`'Credit'` is in the DB `payment_method` enum + `interface.ts` + the
`transactions/db.ts` `PaymentMethod` union + `features/transactions/api.ts`, but
deliberately **NOT** in the route's `paymentMethodSchema` nor the shared
`@surevax/shared` schema — it is internal-only (minted by `applyPrepayment`,
never posted directly by a client).

**Pay-on-account (2026-07-25) is a third mechanic**: a tendered amount is
allocated across a patient's open bills oldest-first (by `transacted_at`), one
`addPaymentTx` leg per bill. Overage banks as patient credit only when the
caller passes `allowCredit: true`; otherwise it 422s `OVERPAYMENT_NOT_ALLOWED`
with the computed excess (MONEY-5's per-bill reject is unchanged). See
`payOnAccount` + `applyCreditOnAccount` in `apps/backend/src/modules/transactions/db.ts`
and the pure allocator in `apps/backend/src/modules/transactions/allocate.ts`
(`planAllocation`, `planCreditDraw`: DB-free, unit-tested).

## Multi-patient transactions — per-line patient + sub-headers (2026-06-20)

One transaction/receipt can bill several patients (family/group), settled by
**one combined payment**, with **per-patient BIR SC/PWD discounts**.

- **`transactions.patient_id`** stays the **primary / bill-to patient** (header).
  Keeps the D2 trigger, idempotency, `applyPrepayment` (credit drawn against the
  primary), `getPatientCredit`, and PHI-detail logging working on the primary.
- **`transaction_items.patient_id`** (nullable bigint, added 2026-06-20):
  the patient a line is billed for. **NULL ⇒ inherit the header/primary patient.**
  Reads `COALESCE(item.patient_id, txn.patient_id)`. `createTransaction` writes it
  only when ≠ primary.
- **`transaction_patients`** (new sub-header, bigserial-only — no display_id):
  one row per `(transaction_id, patient_id)` holding that patient's
  `discount_id_type`/`discount_id_number` + optional `encounter_id`.
  `createTransaction` **always** writes ≥1 row (the primary). Legacy/seed txns
  without rows fall back to the header patient + header discount on read.
  Tenant-RLS only (no `branch_id` → branch policy auto-skips); audited; composite
  tenant-FKs in `0003_invariants.sql`.
- **Per-patient discount:** `computeTransactionTotals` (backend) +
  `computePreviewTotals` (frontend `totals.ts`) take a per-line `discountType`;
  each line uses ITS patient's discount, falling back to the transaction-wide one.
- **Consent + D2 per patient:** `createTransaction` calls `assertActiveConsent`
  once per unique effective patient (this **also closed a pre-existing gap** —
  non-bundle creates previously ran no consent check), and mirrors the D2
  branch-invariant for SECONDARY patients (the DB trigger only validates the
  primary) → returns `409 D2_CROSS_BRANCH_SECONDARY`. `fanOutBundle` is called
  per item with that item's patient + encounter, not the header.
- **`transaction_items_txn_service[_no_physician]_uniq`** now include
  `patient_id` with **`NULLS NOT DISTINCT`** (`0005_modern_pg.sql`) — so two
  patients can get the SAME service on one bill while same-patient duplicate lines
  are still rejected.
- Request shape (`createTransactionSchema`, both backend contract + shared):
  `items[].patientId?` + `patients: [{ patientId, encounterId?, discount? }]`
  (additional patients; the primary's discount is the top-level `discount`).
  Detail response carries `patients[]` (per-patient discount + subtotal) and each
  item row carries `patient`.
- **AR attribution (2026-07-25)**: `patient_accounts` (balance/ledger/AR) attributes
  the WHOLE header balance to the PRIMARY bill-to patient, because `net_amount`/
  `amount_paid`/`amount_outstanding` live only on the transaction header and
  `transaction_patients` carries no money columns. Secondary patients contribute
  nothing to their own balance and see the bill under the ledger's `relatedBills`
  instead, outside every running total. Don't try to fix this by joining
  `transaction_patients` for a per-patient split: the money isn't there to split.
- **Corporate group-bill exception (2026-08-22):** when the transaction is linked
  to `group_bills`, the payer owns AR and the linked transaction is excluded from
  every patient AR/balance/credit calculation. `transactions.patient_id` is the
  first real patient's compatibility clinical anchor only; exact patient/service
  allocation stays in `transaction_patients`/`transaction_items`. Do not create a
  placeholder patient or invent proportional patient payment allocations. The
  linked transaction remains the money/payment/receipt/day-summary/void/refund
  engine.

## D2 branch-invariant trigger on `transactions` (`0003_invariants.sql` — folded from 0025_d2_branch_isolation.sql in the 2026-05-28 consolidation)

`enforce_transaction_branch_invariant()` is a `BEFORE INSERT` trigger on `transactions`.
It rejects an INSERT where `NEW.branch_id` ≠ `encounters.branch_id` of the most-recent
`Completed` `clinical_orders` row for that patient (ordered by `completed_at DESC`).

Key behaviours:

- **First-ever patient** (no `Completed` clinical_order) → INSERT is allowed at any branch.
- **Mismatch** → `RAISE EXCEPTION … USING ERRCODE = 'check_violation'` (23514). Same
  error code as the negative-inventory guard — translate to a 409/422 at the route.
- **UPDATE** on transactions is NOT affected (UPDATE goes through the immutability trigger
  in `0004_immutability_and_generated.sql`, not this one).
- The trigger queries `clinical_orders` + `encounters` with the calling session's GUCs
  already set by `withTenantTx` — no `SECURITY DEFINER` needed.
- `clinical_orders.deleted_at IS NULL` is included in the lookup to exclude soft-deleted orders.

Integration test: `apps/backend/tests/integration/d2-branch-isolation.test.ts`.

## AUTH-2: two-role split + helper trio (cutover landed 2026-05-28)

RLS is now actually enforced at the DB layer (previously inert because the
app connected as a `BYPASSRLS` superuser — see [`risks.md`](risks.md) #7).
Two Postgres roles, written into env vars:

- `surevax_app` — `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`.
  All `SELECT/INSERT/UPDATE/DELETE` on `public.*`, `EXECUTE` on functions, +
  `ALTER DEFAULT PRIVILEGES` for new objects. Created by
  `0001_extensions_and_rls.sql` (idempotent DO block). This is what the app
  process connects as. `DATABASE_URL` → this role.
- `surevax_migrator` — the BYPASSRLS master (locally `surevax`, on Railway
  the service master). Used by `migrate.ts` and `seed/db.ts` only.
  `DATABASE_MIGRATOR_URL` → this role.

`apps/backend/src/shared/db/withTenantTx.ts` exports three helpers — pick by
caller shape:

| Helper           | When                                                                                       | Sets                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `withTenantTx`   | Known tenant + known user (HTTP route handlers)                                            | `current_tenant_id`, `current_user_id`, `current_branch_id`, `cross_branch_read`      |
| `withSystemTx`   | Known tenant, NO user (workers, retention jobs, middleware before auth, audit-from-system) | Same as withTenantTx but `current_user_id=''` + `is_system='true'`                    |
| `withPlatformTx` | Cross-tenant operations (analytics aggregator, tenant slug resolver, platform admin)       | `is_platform_admin='true'` (bypass) + optional `current_tenant_id` for audited writes |

For SELECT-only reads, `userId: 0` is a safe sentinel in `withTenantTx` — the
audit trigger only fires on INSERT/UPDATE/DELETE so the GUC's exact value
doesn't FK-violate. Writes must pass a real `userId`.

**CI gate**: `scripts/check-bare-db-writes.sh` (wired into `pnpm agent:check`)
blocks new bare `db.(insert|update|delete|execute|transaction)` calls in
changed files under `apps/backend/src/{modules,workers,shared}/`. Reads are
allowed (PG RLS scopes them). Allowlist: `seed/db.ts`, `migrate.ts`,
`shared/db/index.ts`, and `shared/db/withTenantTx.ts`. Without the gate the
wrappers added during the capstone decay over time.

**Branch-isolation NULL semantics (AUTH-3 decision)**: the
`branch_isolation` policy (0022) treats `branch_id IS NULL` as visible to
every branch within a tenant. This is INTENTIONAL — it's the only way for
tenant-wide reference data (TenantAdmin users, `service_catalog` without a
branch override, tenant-level `feature_flags`, default `service_prices`,
tenant-wide `user_roles`, etc.) to be reachable from any branch. PHI tables
(`patients`, `encounters`, `clinical_orders`, `transactions`, etc.) all
declare `branch_id NOT NULL`, so the NULL branch is unreachable for them —
no leak vector. The five tables with nullable `branch_id` today are
`tenant_counters`, `audit_logs`, `feature_flags`, `user_roles`,
`service_prices`. If a new PHI-bearing table is added with nullable
`branch_id`, the policy must be revisited.

**Pre-cutover deploy path**: `migrate.ts` and `seed/db.ts` fall back to
`DATABASE_URL` when `DATABASE_MIGRATOR_URL` is unset (logs a warning). This
lets a Railway deploy with the new code roll out before the env var is set,
without crashing the boot.

## SQL template `.append()` does not insert whitespace

drizzle's `sql.append()` concatenates fragments without inserting any separator. If two adjacent fragments meet at a parameter and a keyword, you get malformed SQL.

Real bug from [#432](https://github.com/njvil/surevax-cms-revamp/pull/432) in `apps/backend/src/modules/notifications/db.ts`:

```ts
// BAD — empty filters collapse and the chain becomes "... = $1ORDER BY ..."
NOTIFICATION_SELECT.append(sql`WHERE n.tenant_id = ${tenantId}`)
  .append(emptyStatusFilter) // sql``
  .append(sql`ORDER BY n.created_at DESC LIMIT ${limit}`)
// Postgres: error 42601 — trailing junk after parameter at or near "$1ORDER"

// GOOD — leading whitespace on every fragment
NOTIFICATION_SELECT.append(sql` WHERE n.tenant_id = ${tenantId}`)
  .append(statusFilter)
  .append(sql` ORDER BY n.created_at DESC LIMIT ${limit}`)
```

Empty `sql\`\`` filters are safe — they contribute zero characters. The trap is when a non-empty fragment's first token (`WHERE`, `ORDER BY`, `AND`) butts up against the prior fragment's last token (a `${param}`). Always start each appended fragment with a space.

The original route handler silently swallowed the underlying error and returned a bare 500, so the bug was invisible in operator logs. **When a route catches a DB error and returns 500, log the structured error with `logger.error(...)` first** — the notifications route is now the canonical example.

## `<Tooltip>` requires a `<TooltipProvider>` ancestor

shadcn/Radix `<Tooltip>` reads context from `<TooltipProvider>` and throws on render if none is present:

```
Error: Tooltip must be used within TooltipProvider
```

`AppShell` now wraps `<AppRoutes>` in a single root-level `<TooltipProvider delayDuration={200}>` (App.tsx, landed in [#426](https://github.com/njvil/surevax-cms-revamp/pull/426)). Nested providers are safe — `AcronymHint` keeps its own internal one. Without the root provider, every page that renders `ComingSoonButton`, `PatientDetail` action tooltips, claim-detail row tooltips, or attachment-list hovers crashes into the ErrorBoundary.

When adding a new component that uses `<Tooltip>` directly (not via `AcronymHint`), do NOT wrap a per-call-site provider — the root one already covers it. If a sub-tree needs a different `delayDuration`, wrap that subtree in its own provider instead of changing the root.

## `DirtyFormGuard` — SPA-nav prompt active (data router migration M8)

`apps/frontend/src/components/layout/DirtyFormGuard.tsx` uses `useBlocker`
from `react-router-dom` for in-app SPA navigation AND `beforeunload` for
tab close / hard refresh.

The app was migrated from `<BrowserRouter>` to `createBrowserRouter` +
`RouterProvider` (M8, landed alongside this note). Both guards are now active:

- Tab close / refresh / hard navigation → browser's native "Leave site?" prompt ✅
- SPA navigation (sidebar click, programmatic navigate) → shadcn `<AlertDialog>` ✅

`main.tsx` exports a `createBrowserRouter(routes)` instance; `App.tsx` exports
the `routes: RouteObject[]` array with `AppRoot` (AuthProvider + TooltipProvider)
as the top-level layout element. Surfaces that use `<DirtyFormGuard>` (Arrivals
wizard, TransactionsCreatePage, patient Conditions / Allergies cards) are
protected.

## `/api/auth/me` response shape: `{ user: AuthUser }` envelope

Both `/api/auth/login` and `/api/auth/me` return `{ user: AuthUser }`. The frontend `LoginPage` unwraps with `setUser(data.user)`; the auth context's `/me` effect must do the same. A pre-#426 bug had `setUser(data)` (no unwrap) on the `/me` path, which made `user.firstName` undefined and crashed AppShell every reload.

`AuthUser` carries `firstName` + `lastName` (loaded from DB via `findUserByDisplayId` in the auth middleware). The previous shape (JWT-payload only) didn't include them, so any consumer that touched `user.firstName[0]` (avatar initials) crashed. New consumers should still defend defensively — `user.firstName?.[0] ?? ''` — but the canonical shape now matches the type.
