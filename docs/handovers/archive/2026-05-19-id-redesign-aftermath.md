# ID Redesign Aftermath — Handover

**Date:** 2026-05-19
**Status:** ID redesign shipped to `main` at `b18a4f3` (PR [#392](https://github.com/njvil/surevax-cms-revamp/pull/392)). This handover covers five tracked follow-ups left behind by that 95-commit landing.

## What you should know first

The ID redesign moved every entity table from text-PK (`PAT-K9MX3VQ2P5`) to `bigserial` PK + `display_id text NOT NULL UNIQUE` (e.g. `PAT_K9MX3VQ2`). FKs are `bigint`. API responses alias bigint id → display_id in `.select()` projections; the bigint never leaves the backend. JWT carries display_ids (`userId`, `tenantSlug`, `branchCode`) and the auth middleware resolves them to bigint at request time.

Authoritative spec lives at [`docs/handovers/archive/2026-05-18-id-redesign.md`](archive/2026-05-18-id-redesign.md) (now archived). Conventions are baked into [`.claude/rules/gotchas.md`](../../.claude/rules/gotchas.md) ("Display IDs — two-tier model (landed 2026-05-19)") and [`.claude/rules/patterns.md`](../../.claude/rules/patterns.md) (Migration Safety, FK Cascade, Drizzle Limitations sections).

Canonical post-redesign module pattern: [`apps/backend/src/modules/payer_profiles/db.ts`](../../apps/backend/src/modules/payer_profiles/db.ts) — internal bigint id with `.select()` projection surfacing `display_id` as the public `id`, `resolvePayerByDisplayId` helper at the top of every write route, `withTenantTx` for every write block.

## Outstanding follow-ups (priority order)

### 1. Rewrite five skipped test files

Five integration suites still hardcode pre-redesign fixtures (`TEN-SUREVAX`, `PAT-AAA…`, `USR-AAA…`, `AUD-2026-…`, manual bigserial inserts). They're `describe.skip('…', …)` with TODO notes at the top of each file.

Files:

- [`apps/backend/tests/audit.test.ts`](../../apps/backend/tests/audit.test.ts)
- [`apps/backend/tests/transactions.test.ts`](../../apps/backend/tests/transactions.test.ts)
- [`apps/backend/tests/integration/rls-multi-tenant.test.ts`](../../apps/backend/tests/integration/rls-multi-tenant.test.ts)
- [`apps/backend/tests/integration/status-history-triggers.test.ts`](../../apps/backend/tests/integration/status-history-triggers.test.ts)
- [`apps/backend/tests/integration/tenant-resolution.test.ts`](../../apps/backend/tests/integration/tenant-resolution.test.ts)

Mechanical rewrite — for each helper (`loginAsAdmin`, `createTestPatient`, etc.) replace text-PK literals with `displayId('PAT')` / `'SVX'` / `formatMrn(n)` and let `audit_logs.id` auto-increment (no manual insert). Use [`apps/backend/src/modules/payer_profiles/db.ts`](../../apps/backend/src/modules/payer_profiles/db.ts) and [`apps/backend/src/shared/db/seed/patients.ts`](../../apps/backend/src/shared/db/seed/patients.ts) as references. Unskip the `describe.skip` blocks once helpers are updated.

Effort: ~2–3 hours single agent. Largest blast radius is fixture rewriting — once the helpers are right, the `it(...)` bodies need minimal changes.

### 2. Wire PSO + clinical_orders + clinical-order consents seed

`seedEncounters` ([`apps/backend/src/shared/db/seed/encounters.ts`](../../apps/backend/src/shared/db/seed/encounters.ts)) creates 15 encounters but soft-skips PSO, clinical_orders, and clinical-order consents with the marker:

```
↷ patient_standing_orders + clinical_orders + clinical-order consents (deferred — needs catalog + standing-order template seeds)
```

That was true at the time the encounters worker landed, but `seedCatalog` and `seedStandingOrders` are now wired upstream of `seedEncounters` in [`apps/backend/src/shared/db/seed.ts`](../../apps/backend/src/shared/db/seed.ts). The downstream rows can be re-enabled by:

1. Extending `seedEncounters` to accept the `servicesByCode` Map from catalog and a templates list (query `standing_order_templates` at the top of the function or take a Map argument).
2. For each seeded encounter, choose a standing_order_template appropriate to the specialty (Rabies → `ARV_PEP_5DOSE`, etc.) and call `startStandingOrderTx` to generate the PSO + clinical_orders chain.
3. Insert representative consents (informed consent per encounter) using the polymorphic `consents.scope_ref_type` / `scope_ref_id` pair (text + display_id of the encounter).
4. Return the clinical-order display→bigint Map so `seedLabOrders` (follow-up #3) can consume it.

Effort: ~2 hours. Use [`apps/backend/src/modules/standing_orders/db.ts`](../../apps/backend/src/modules/standing_orders/db.ts) `startStandingOrderTx` — it takes display_id inputs and resolves internally.

### 3. Wire lab_orders seed

`seedLabOrders` currently soft-skips with `lab orders (skipped — clinical orders not yet seeded)`. Once #2 lands and returns a clinical-order Map, pass it in from the orchestrator:

```ts
await seedLabOrders({
  tenantId,
  branchId: branches.hst,
  createdById: users.physician,
  encounters: clinicalOrdersByDisplayId, // from #2's return
  partnerLabs: seededPartnerLabs.byCode,
})
```

Reference: [`apps/backend/src/shared/db/seed/lab-orders.ts`](../../apps/backend/src/shared/db/seed/lab-orders.ts).

Effort: ~30 min once #2 is done.

### 4. Sweep stale handover refs

These docs still reference handovers that were moved to [`docs/handovers/archive/`](archive/):

- `README.md`
- `TODO.md`
- `docs/ai-context/*` (`00-SYSTEM-CORE.md`, `01-DATA-AND-COMPLIANCE.md`, `03-FRONTEND-UI-UX.md`, `06-PRODUCT-WORKFLOWS.md`, `_INDEX.md`)
- `docs/runbooks/phase4-drops.md`

```bash
grep -rln "2026-05-18-id-redesign\|2026-05-01-schema-v2\|2026-05-06-orchestrate-\|2026-04-28-design-density\|2026-05-10-search-first\|2026-05-17-catalog-abstraction\|2026-05-17-format-module\|2026-05-17-orchestrate-shipping\|2026-05-17-ui-ux-audit\|2026-05-02-scheduled-orders" README.md TODO.md docs/
```

For each match, repoint to `docs/handovers/archive/<filename>.md` or remove the reference if it's stale. ~15 min mechanical sweep.

### 5. Audit-log redesign Waves A–C

Per [`docs/handovers/2026-05-18-audit-log-redesign.md`](2026-05-18-audit-log-redesign.md):

- **Wave A (3–4 parallel workers, ~3 hours):** app-side call sites for `LOGIN_FAILED`, `BREAK_GLASS`, `EXPORT`, `PRINT`, `PERMISSION_CHANGE`, `CONFIG_CHANGE`, `AUDIT_ACCESS`. The enum values + trigger attachment list trim are already done in the redesign W1.B.
- **Wave B (single worker, ~2 hours):** SHA256 tamper-evidence hash chain on `audit_logs`. Use `pgcrypto` (already installed).
- **Wave C (single worker, ~1 hour):** 10-year retention via `retain_audit_partitions(retain_years int)` proc + `pg_cron` schedule.

Each wave is a separate session — they don't overlap and Wave A can run alongside any feature work.

## Soft items worth knowing

- **`tenants` table has both `id` and `slug` columns.** The spec said "the slug IS the PK" but the implementation kept `slug` as a separate text column on the table (per the W2 worker's call). `tenants.id = 'SVX'` (the PK) matches `tenants.slug = 'surevax-demo'` in the seed. The tenant middleware queries `WHERE slug = ${header}` → returns `tenants.id`. If you find this confusing later, consider collapsing them into a single column.
- **`inventory_movements` polymorphic kept typed FKs only.** W1.A worker added a redundant `entity_type`/`entity_id` pair; W1.B dropped it. The module reads from `clinical_order_id`/`inventory_adjustment_id`/`inventory_transfer_id` columns.
- **Idempotency middleware replay** was patched in W3.c.5 to return `display_id` on replay (was previously bigint). If new endpoints adopt idempotency, mirror that pattern.
- **postgres-js bigint coercion** is at the driver layer ([`apps/backend/src/shared/db/index.ts`](../../apps/backend/src/shared/db/index.ts)) — OID 20 → JS Number. Every `bigint(...)` column in [`schema.ts`](../../apps/backend/src/shared/db/schema.ts) uses `mode: 'number'` to match.
- **Drizzle `.for('update', { skipLocked: true })` is not supported.** [`fefo.ts`](../../apps/backend/src/modules/inventory/fefo.ts) falls back to raw `sql` template with `FOR UPDATE OF il SKIP LOCKED`.
- **`CI workflow env`** uses `PHASE_1_TENANT_ID: SVX` (was `TEN-SUREVAX` before the merge). If anyone forks the workflow for a new tenant, mirror the slug change.

## Operational notes

- Trunk branch `claude/id-redesign-trunk` is intentionally left in place so the worktree continues to track it. If you reuse the worktree for a follow-up, `git checkout main && git pull` first.
- Five sibling worker worktrees in `.claude/worktrees/agent-*/` were not cleaned up. They can be removed with `git worktree remove --force <path>` once you're confident nothing depends on them.
- The shared `surevax-dev-postgres` Docker container has dozens of `surevax_w5_*` and `surevax_agent_*` DBs left over from the seed verification. `docker exec surevax-dev-postgres psql -U surevax -d postgres -c "..."` to clean if disk pressure shows up.

## How to start the next session

```bash
cd /Users/njvil/Documents/Personal_Projects/surevax-cms-revamp
git checkout main && git pull
# Verify backend typecheck stays green:
PNPM=/opt/homebrew/opt/node@22/bin/pnpm
$PNPM --filter @surevax/backend typecheck   # expect 0 errors
# Pick a follow-up above and read its referenced files. Most are <2-hour units.
```

The cheapest next move is follow-up #4 (stale handover refs) — pure sweep, no risk, ships in one PR. The most user-visible is #2 + #3 (full clinical seed) which unblocks Wave 3.c's status-history triggers for proper integration tests.
