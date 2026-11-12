# Handover — Post AUTH-2 capstone: pending items

**Date:** 2026-05-28
**Origin:** Audit follow-up from [`2026-05-27-comprehensive-codebase-audit.md`](2026-05-27-comprehensive-codebase-audit.md) + the AUTH-2 capstone PR landing today.

The ~80-finding audit is now ~76 closed. Six items remain — four from the audit, two from the AUTH-2 cutover itself. Each section names the next action concretely.

---

## 1. AUTH-2 Railway cutover (✅ APPLIED + VERIFIED on `development` — 2026-05-31)

**Done for the only deployed env.** The `development` Railway env is cut over to
the two-role split and RLS is enforcing in the deployed app — verified end-to-end
2026-05-31: `surevax_app` shows `rolsuper=f, rolbypassrls=f`; the live app pool
connects as `surevax_app` (confirmed via `pg_stat_activity`); `POST /api/auth/login`
returns 200; and a cross-tenant probe under `app.current_tenant_id` returns 0 rows
for a non-`SVX` tenant. There is no separate `production` env (all deployed envs run
`NODE_ENV=development`), so this closes the item. The procedure below is retained as
the runbook for any future env — see [`docs/runbooks/auth2-rls-cutover.md`](../../runbooks/auth2-rls-cutover.md).

### What's required

One-time per Railway env (dev + production):

```bash
# 1. SSH/connect to the Railway Postgres instance and rotate the surevax_app password.
#    0001_extensions_and_rls.sql already created the role on the next migrate.
railway connect Postgres
\password surevax_app   # paste a strong unique value
\q

# 2. Update the surevax-cms-revamp service vars. DATABASE_URL points at the new
#    role, DATABASE_MIGRATOR_URL points at the existing master role.
railway variables --service surevax-cms-revamp --set \
  DATABASE_URL='postgresql://surevax_app:<paste>@postgres.railway.internal:5432/railway' \
  DATABASE_MIGRATOR_URL='postgresql://<master-user>:<master-pw>@postgres.railway.internal:5432/railway'

# 3. Trigger a redeploy. migrate.ts will reuse DATABASE_MIGRATOR_URL; the app
#    runtime will connect as surevax_app (NOBYPASSRLS).
railway up --detach
```

Smoke probes on the deployed env (must all pass):

```bash
# rolsuper + rolbypassrls MUST be false on surevax_app:
railway connect Postgres
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='surevax_app';

# Login must return 200 (the canary):
curl -i -X POST https://<host>/api/auth/login \
  -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' \
  -H 'X-Tenant-Slug: SVX' \
  -d '{"email":"admin@surevax.com","password":"…"}'
```

If login fails 401 the most likely cause is a route that still reads with bare `db.x` — `pnpm agent:check` runs `scripts/check-bare-db-writes.sh` which blocks new bare writes; existing reads are already wrapped per the capstone but PR-time CI is the canonical check.

### Optional: nuke + redeploy the Railway dev DB

Worth considering for the dev environment only (NOT production):

- The 28-supplemental SQL chain runs idempotently on every deploy, so a re-migration won't break anything. But a fresh database makes the role+grants reapply from scratch and removes any stale `surevax_app` row that might have been hand-created during the cutover dance.
- Production should NEVER be nuked — the role + grants apply idempotently and the data must be preserved.

The dev nuke path:

```bash
railway connect Postgres
DROP DATABASE railway;          # ⚠️ destructive; only on dev
CREATE DATABASE railway;
\q
# Now redeploy — migrate.ts will rebuild from 0000 + supplementals + seed.
railway up --detach
```

After the dev cutover, follow the same smoke probes above.

### Acceptance criteria (all met on `development`, 2026-05-31)

- [x] `surevax_app` exists in Railway Postgres with `rolsuper=false, rolbypassrls=false`.
- [x] `DATABASE_URL` (→ `surevax_app`) and `DATABASE_MIGRATOR_URL` (→ master `postgres`) both set in the `surevax-cms-revamp` service vars.
- [x] Latest deploy boots green (no `permission denied for table`); the live app pool connects as `surevax_app` (`pg_stat_activity`).
- [x] `POST /api/auth/login` returns 200 + cookies.
- [x] Cross-tenant probe: as `surevax_app`, `app.current_tenant_id='SVX'` → 20 patients; a non-`SVX` tenant → 0 rows.

---

## 2. Supplemental SQL consolidation (~~deferred~~ DONE in capstone PR)

The 22-file accretion 0008–0029 was folded back into the 7 themed supplementals
(`0001`–`0007`) in the same PR as AUTH-2. Final shape: 8 files
(`0000` baseline + `0001`–`0007` themed). `migrate.ts SUPPLEMENTAL_SQL_FILES`
trimmed to 7 entries. Verified by full nuke + `pnpm setup --force` +
`pnpm test` (116/116 green) + cross-tenant probe.

DB-6 is also resolved as part of this work (the dead recreate block was in 0005
and survived; it remains a harmless no-op — see §6 below).

The original mapping table is preserved below for reference:

The migration runner applies 29 supplemental files (`0001`–`0029`) after the Drizzle baseline. The audit + the AUTH-2 capstone added several since the last consolidation (2026-05-18, which folded 0008-0020 into the themed 0001-0007).

**Current count:** 30 files (0000 baseline + 29 supplementals).
**Target after consolidation:** 8 files (0000 + 7 themed supplementals).

### Mapping for the next consolidation pass

Fold each post-#228 supplemental back into the themed file that owns its concern:

| Current file                               | Target theme                            |
| ------------------------------------------ | --------------------------------------- |
| `0008_session_timeouts.sql`                | `0001` (infra / extensions)             |
| `0009_audit_chain.sql`                     | `0002` (audit)                          |
| `0010_audit_retention.sql`                 | `0007` (retention procs)                |
| `0011_audit_chain_verifier.sql`            | `0002` (audit) or `0007` (proc)         |
| `0012_tenant_counters.sql`                 | `0001` (infra) or `0003` (invariants)   |
| `0013_health_card_attachment.sql`          | `0000_initial.sql` (column add)         |
| `0014_platform_users_mfa.sql`              | `0000_initial.sql` (column add)         |
| `0015_tag_definitions_effective_dates.sql` | `0000_initial.sql` (column add)         |
| `0016_transactions_branch_seq.sql`         | `0000_initial.sql` (column add)         |
| `0017_negative_inventory_check.sql`        | `0003` (invariants)                     |
| `0018_dpa_purge_function.sql`              | `0007` (retention)                      |
| `0019_junction_fk_cascades.sql`            | `0000_initial.sql` (FK definitions)     |
| `0020_audit_trigger_strict.sql`            | `0002` (audit) — superseded by 0024     |
| `0021_pin_attempts.sql`                    | `0000_initial.sql` (table add)          |
| `0022_rls_hardening.sql`                   | `0001` (RLS)                            |
| `0023_phi_access_log_nullable_patient.sql` | `0000_initial.sql` (nullability)        |
| `0024_audit_trigger_strict.sql`            | `0002` (audit) — supersedes 0020        |
| `0025_d2_branch_isolation.sql`             | `0003` (invariants) or `0004` (immut.)  |
| `0026_cross_branch_phi.sql`                | `0006` (FHIR view) + `0000` (table)     |
| `0027_idempotency_unique.sql`              | `0003` (invariants) or `0005` (uniques) |
| `0028_db_remediation.sql`                  | split across `0000`/`0002`/`0003`       |
| `0029_fhir_views_security_invoker.sql`     | `0006` (FHIR views)                     |

### Path

1. Regenerate `0000_initial.sql` via `drizzle-kit generate` from current `schema.ts`. This will already include all column adds, table adds, nullability changes, FK definitions — items in the "column add" rows above.
2. Inline the remaining concerns into the matching `0001`–`0007` themed file (kept as `CREATE OR REPLACE` / `DROP IF EXISTS` to preserve idempotency).
3. Empty out `SUPPLEMENTAL_SQL_FILES` array in `migrate.ts` to just the 7 themed entries.
4. Verify by `pnpm setup --force` against a freshly-nuked dev DB — should still seed + login green.
5. **Do NOT run this against production until the dev nuke confirms a clean rebuild.** The supplementals are idempotent, but the consolidation is destructive of file history.

### Acceptance criteria

> **✅ DONE.** Consolidation landed in the AUTH-2 capstone (see header above).

- [x] `apps/backend/drizzle/` contains the 8 themed files (`0000` + `0001`–`0007`) plus the later additive `0008_onboarding_channel.sql` (a column-add, not part of the consolidation).
- [x] `pnpm setup --force` on a nuked dev DB runs clean and passes the smoke probes (re-verified 2026-06-03).
- [x] `pnpm --filter @surevax/backend test` green (the suite has grown well past the original 116).

---

## 3. INFRA-6 — Railpack `DRIZZLE_DIR` implicit dep

[`apps/backend/src/shared/db/migrate.ts:13`](../../../apps/backend/src/shared/db/migrate.ts:13) resolves `DRIZZLE_DIR = path.resolve(__dirname, '../../../drizzle')`. After Railpack builds, `__dirname` is `dist/shared/db/`, so the path walks back to the source `drizzle/` tree. This works today because the Railpack image preserves the source tree, but it's an implicit uncopied build dependency — a future Railpack tweak that prunes source could break migrate at boot.

### Fix

Either:

- **(a)** Copy `apps/backend/drizzle/` into `dist/drizzle/` as a build step (cleanest — `dist/` becomes self-contained). Update `railpack.json` to include the copy.
- **(b)** Make `DRIZZLE_DIR` env-configurable: `process.env.DRIZZLE_DIR ?? path.resolve(__dirname, '../../../drizzle')`. Railway env then sets `DRIZZLE_DIR=/app/drizzle` explicitly.

Option (a) is the convention — keeps the runtime self-contained. Option (b) is a 2-line patch but adds an env knob.

### Acceptance criteria

> **✅ DONE (2026-06-03) — option (a) + (b) both landed.** `resolveDrizzleDir()` in
> `migrate.ts` implements the precedence `DRIZZLE_DIR` env → `dist/drizzle` copy →
> source fallback, AND the backend `build` script runs `cp -R drizzle dist/drizzle`
> so `dist/` is self-contained. Local `db:deploy` (via `pnpm setup`) resolves the
> dir without `ENOENT`.

- [x] `db:deploy` applies supplemental SQL (`Applying supplemental SQL: 0001_…`) without `ENOENT` — confirmed locally; the next Railway deploy boot log will show the same.
- [x] Smoke test: `pnpm --filter @surevax/backend db:deploy` succeeds with the new resolution (local; `railway run` equivalent on next deploy).

---

## 4. MONEY-5 — `addPayment` unbounded overpayment, no change ledger (✅ DONE 2026-06-03 — cap-and-reject)

**Resolved with the cap-and-reject model** (the documented default). `addPaymentTx`
now sums the existing (positive) partial payments before inserting and throws
`LifecycleError('… exceeds the outstanding balance …', 'OVERPAYMENT_NOT_ALLOWED', 422)`
when the new payment would push `amount_paid` above `net_amount`. The pre-existing
`ALREADY_PAID` guard still fires first for a payment against an already-`Paid` txn.
Rationale for cap-and-reject: a `payments` row records the amount **applied to the
bill**, not cash tendered — change due is a drawer concern, so over-applying to a
transaction is never valid; no schema change needed.

The frontend `AddPaymentDialog` gained an `outstanding` prop (wired from
`TransactionDetail`'s `balanceStr`): it shows the outstanding balance under the
amount field, swaps to a destructive over-balance message + disables the submit
button while the entered amount exceeds it, and guards `onSubmit` for keyboard
submits. The backend stays the source of truth (the 422 surfaces via the existing
`apiErrorMessage` toast).

The original analysis is retained below for history.

[`apps/backend/src/modules/transactions/db.ts:1067`](../../../apps/backend/src/modules/transactions/db.ts:1067) — `addPaymentTx` does not cap `args.amount` against `(netAmount - amountPaid)`. A cashier can submit any amount; nothing emits a change-due line or rejects overpayment.

### Needs product decision first

Two viable models:

- **Cap-and-reject** — refuse the payment when `amount > outstanding`; cashier types the exact remaining amount. Simplest, no schema change.
- **Allow-with-change** — accept overpayment, compute `change_due = amount - outstanding`, persist as a `change_due` line on `transactions` (or a negative-direction `payment` row). Requires schema + receipt-print change.

Default to **cap-and-reject** unless the product owner prefers the change-due flow.

### Fix sketch (cap-and-reject path)

In `addPaymentTx` before insert:

```ts
const outstanding = parseDecimal(txn.netAmount) - amountPaidSoFar
if (parseDecimal(args.amount) > outstanding) {
  throw new LifecycleError(
    `Payment amount ${args.amount} exceeds outstanding ${outstanding}`,
    'OVERPAYMENT_NOT_ALLOWED',
    422,
  )
}
```

`amountPaidSoFar` query needs to sum existing `payments.amount` for the txn (excluding voids) — likely already in the lifecycle code nearby; reuse if possible.

### Acceptance criteria

- [x] Repro: `POST /api/transactions/<id>/payments` with `amount = netAmount × 2` returns 422 `OVERPAYMENT_NOT_ALLOWED`, and the rejected payment does not persist (txn stays `Pending`, 0 payments).
- [x] Integration tests added — three cases in [`apps/backend/tests/transactions.test.ts`](../../../apps/backend/tests/transactions.test.ts) under the `POST /api/transactions/:id/payments` block (single overpayment rejected; partial-then-exact accepted then a third rejected `ALREADY_PAID`; partial overshoot rejected). Co-located with the existing supertest payment flow rather than a new `tests/integration/` file because that dir uses the `withRollback` raw-pg harness, which is incompatible with supertest (see `patterns.md` "BEGIN/ROLLBACK test isolation").
- [x] Frontend `AddPaymentDialog` blocks the submit (disabled button + inline over-balance message); the backend 422 remains the source of truth.

---

## 5. SEC-7 — Operator DB-backed lockout

[`apps/backend/src/modules/auth/operatorRoutes.ts:50-56`](../../../apps/backend/src/modules/auth/operatorRoutes.ts:50) — in-process lockout is in place (`5 failures → 15-min lockout`), but it resets on every process restart. The inline TODO calls out the proper fix: extend `platform_users` with `failed_login_count` + `locked_until`, then mirror the tenant-side `auth/db.ts` lockout pattern.

### Fix

1. Add columns to `platform_users` (new supplemental SQL OR fold into a regenerated `0000` once consolidation lands).
2. Mirror the tenant `incrementFailedLogin` / `resetFailedLogin` / `isPinLocked`-style helpers for operator path.
3. Delete the in-process `Map<string, number>` failure counter.

Defer until either (a) operator login becomes a higher-traffic surface than today, or (b) the supplemental SQL consolidation runs so the column-add is cheap to fold in.

### Acceptance criteria

- [ ] `platform_users.failed_login_count` + `locked_until` exist.
- [ ] Repro: 5 failed operator logins → 6th returns 423 even across process restarts.

---

## 6. DB-6 — Dead `users_tenant_email_idx` recreate block

[`apps/backend/drizzle/0005_modern_pg.sql`](../../../apps/backend/drizzle/0005_modern_pg.sql) has a CITEXT-recreate block gated on `WHERE email <> email::citext` — always false on fresh DBs because `email` is already `citext` from `0000_initial.sql`. Harmless idempotent no-op.

Per the AUTH-2 handover: **intentionally deferred** — "Not worth a historical-migration edit." Fold into the supplemental consolidation pass (§2) when that runs, and delete in the same regeneration.

### Acceptance criteria

- [x] Reviewed (2026-06-03). **Kept intentionally — it is a defensive guard, not dead code.** On inspection the block in `0005_modern_pg.sql` only ALTERs `email` → `citext` when the column is still `text` (gated on `information_schema` `udt_name <> 'citext'`, so it's skipped on fresh DBs where `0000_initial.sql` already creates `citext`). The guard exists because `0006`'s `fhir_patient_view` depends on `patients.email`, so a blind re-run `ALTER COLUMN TYPE` would fail with a dependent-view error. Removing it would break re-deploys against pre-citext DBs for zero benefit; the fresh-DB no-op is harmless and documented inline.

---

## Recommended ordering

1. **AUTH-2 Railway cutover** (§1) — high-stakes, do FIRST while the capstone PR is fresh and the rollback path is clear.
2. **INFRA-6** (§3) — small, mechanical. Bundle with the cutover or a sibling PR.
3. **Supplemental SQL consolidation** (§2) + **DB-6** (§6) — together. Run only after AUTH-2 Railway cutover is stable; the consolidation changes the migration shape.
4. **SEC-7** (§5) — when an operator-traffic event motivates it OR when consolidation gives a free column add.
5. ~~**MONEY-5** (§4)~~ — ✅ DONE 2026-06-03 (cap-and-reject; no schema change).

---

## What was already done in the capstone PR

For cross-reference — these are CLOSED in the AUTH-2 PR landing today and do not need a separate session:

- AUTH-2 (code) · INFRA-1 (seed `cross_branch_read`) · AUTH-3 (decision documented) · `withSystemTx` + grep gate · 13 module wraps · 11 worker/middleware wraps · `phiAccessLog` 10-tx → 1-tx collapse · `create_next_audit_partitions` marked SECURITY DEFINER · `tenants` chicken-and-egg fixed via `withPlatformTx`.

What remains to verify the capstone end-to-end is the Railway side (§1).
