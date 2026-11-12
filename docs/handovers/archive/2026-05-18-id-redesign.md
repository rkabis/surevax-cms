# Display-ID Redesign — Handover

**Date:** 2026-05-18
**Status:** ✅ COMPLETED 2026-05-19. Schema (W1.A), DDL spine (W1.B), seed + JWT (W2),
backend modules (Wave 3.a/b/c — 16 module units), seed orchestrator wiring, frontend (W4.A),
docs (W4.B). Trunk: `claude/id-redesign-trunk`. End-to-end smoke (W5) and merge to `main` pending.
**Driver:** Audit on 2026-05-18 surfaced inconsistent prefix lengths (1–5 chars), four ID
shapes coexisting (code-suffixed, random, year+random, parent-embedded), 11 dead prefixes
in the type union, 4 stale regex CHECK constraints, and analytics-blocking text PKs.

---

## Locked decisions

1. **Two-tier IDs.** Every entity table gets `id bigserial PRIMARY KEY` (internal) +
   `display_id text NOT NULL UNIQUE` (public). FKs become `bigint`. Junction tables,
   status-history tables, and pure audit tables (audit_logs, domain_events, phi_access_log)
   stay bigserial-only — no display_id.
2. **Display ID shape.** `{PREFIX}_{8-char Crockford base32}` — e.g. `PAT_K9MX3VQ2`.
   8 chars × 5 bits = 40 bits entropy; collision ~1 in 2.5M at 1M rows. Underscore
   separator (Stripe convention; avoids URL/SQL dash ambiguity).
3. **Tenant slug.** No prefix. PK is the slug itself (text, 3–16 uppercase alphanumeric).
   Default tenant = `SVX` (renamed from `TEN-SUREVAX`).
4. **Branch composite display.** Branches have bigserial PK + `code` (3 uppercase
   letters) + `display_id` = `{tenant.slug}.{code}`, e.g. `SVX.HST`. Unique per
   `(tenant_id, code)`.
5. **Patient MRN.** Per-tenant sequential counter using a dedicated Postgres
   `SEQUENCE` per tenant (e.g. `mrn_seq_svx`). Allocated via `nextval()` — atomic,
   concurrency-safe, gaps acceptable on transaction rollback. Format
   `MRN-NNNNNN` (zero-padded 6+ digits). Stored on `patients.mrn`, unique per
   `(tenant_id, mrn)`. Sequence created by a `provision_tenant_counters(slug text)`
   SQL function called at tenant-onboarding time.
6. **Receipt number (BIR).** Deferred entirely — not every transaction will need
   a BIR Official Receipt (e.g. internal transfers, voided rows, partner-billed
   work). Add `transactions.receipt_no text NULL` column but do not auto-generate.
   When BIR registration completes, a follow-up worker introduces a
   `tenant_counters` table (per-branch row, atomic `UPDATE ... RETURNING next_value`)
   to issue gapless sequential receipt numbers only for transactions that need
   one.
7. **Drop year embedding** from all transactional IDs. `created_at` carries the year.
8. **Drop parent embedding.** FK columns encode the relationship; long composite
   IDs are brittle when records re-parent.
9. **Polymorphic FK columns** keep `text` `entity_id` storing the **display_id**
   for human-readable tables (`audit_logs`, `approval_requests`, `attachments`,
   `consents`). The audit trigger denormalizes a copy into `entity_display_id`
   so audit reports never need a join. For purely internal polymorphic refs
   (`inventory_movements`, `notifications`), store `bigint entity_id` instead —
   queries are fast and readers always have the parent context.
10. **API responses never leak internal bigint.** Service layer renames the
    bigint `id` to `display_id` in Drizzle projections before returning. The
    frontend continues to type IDs as `string` end-to-end.
11. **Domain event payloads serialize `display_id`, not bigint.** Producers
    write `{patient_id: patient.display_id, ...}` into the JSONB. Bigint refs
    become opaque the moment they leave Postgres.
12. **JWT carries display_ids.** `{ userId: 'USR_…', tenantSlug: 'SVX',
branchCode: 'HST' }`. Auth middleware resolves to bigint at request time.

---

## Active prefix list (37 prefixes, all 3 letters)

These map 1:1 to `DisplayPrefix` in `apps/backend/src/shared/utils/displayId.ts`.

| Domain           | Prefix     | Table                                                            |
| ---------------- | ---------- | ---------------------------------------------------------------- |
| Tenancy & access | (none)     | tenants — PK is slug, no prefix                                  |
|                  | (none)     | branches — `display_id` = `{slug}.{code}`                        |
|                  | USR        | users                                                            |
|                  | PLU        | platform_users                                                   |
| Patient core     | PAT        | patients (+ `mrn` column for human handle)                       |
| Clinical         | ENC        | encounters (+ `visit_no` per-patient sequential)                 |
|                  | PSO        | patient_standing_orders                                          |
|                  | ORD        | clinical_orders                                                  |
|                  | CNS        | consents                                                         |
|                  | ATT        | attachments                                                      |
| Catalog          | (raw code) | service_catalog — PK is the code itself (e.g. `ARVPEP_IM`)       |
|                  | (raw code) | standing_order_templates — PK is the code                        |
|                  | CAT        | service_categories                                               |
|                  | SBI        | service_bundle_items                                             |
|                  | SEP        | service_eligible_products                                        |
|                  | SVP        | service_prices                                                   |
|                  | PRD        | products                                                         |
|                  | PYR        | payer_profiles                                                   |
|                  | PCT        | payer_contracts                                                  |
|                  | LAB        | partner_laboratories                                             |
|                  | NTP        | notification_templates                                           |
|                  | TGD        | tag_definitions                                                  |
|                  | STI        | standing_order_template_items                                    |
| Inventory        | LOT        | inventory_lots                                                   |
|                  | MVT        | inventory_movements                                              |
|                  | TRF        | inventory_transfers (+ `transfer_ref` for staff handle)          |
|                  | RCL        | product_recalls (+ `recall_no` for external ref)                 |
| Labs             | LBO        | lab_orders                                                       |
| Billing          | TXN        | transactions (+ `receipt_no` deferred)                           |
|                  | TXI        | transaction_items                                                |
|                  | PMT        | payments                                                         |
|                  | CLM        | claims (+ `claim_no` for payer-facing ref)                       |
|                  | CLI        | claim_items                                                      |
| Ops              | APT        | appointments (+ `booking_ref` for phone-readable handle)         |
|                  | TLG        | staff_time_logs                                                  |
|                  | CSH        | cash_drawer_sessions                                             |
|                  | DSS        | day_summary_snapshots (`business_date` already serves as handle) |
| Specialty        | AVE        | adverse_events (+ `case_no` for DOH reporting)                   |
|                  | BIT        | bite_incidents (+ `incident_no` for clinical case file)          |
|                  | AOF        | animal_observation_followups                                     |
| Approvals        | APR        | approval_requests                                                |
|                  | APD        | approval_decisions                                               |

### Tables that do NOT get a display_id (bigserial PK only)

Background, append-only, or natural-key tables — never user-referenced standalone.

- All `*_status_history` tables (7): queried by parent `entity_id`, never standalone
- `audit_logs`: partitioned event log; queried by `entity_type`+`entity_id`+`changed_at`
- `domain_events`: outbox-pattern event source; consumed by workers
- `phi_access_log`: HIPAA/DPA audit; queried by user+patient+time
- `encounter_vitals`, `encounter_diagnoses`: scoped to encounter; addressed via FK
- `patient_allergies`, `patient_conditions`, `patient_emergency_contacts`,
  `patient_external_immunizations`, `patient_tags`: scoped to patient; addressed via FK
- `clinical_order_schedule_changes`: scoped to clinical_order
- `notifications`: scoped to recipient + template; no need for external reference
- `refresh_tokens`: opaque token; PK is just bigserial, `jti` is the natural lookup key
- `user_sessions`, `password_reset_tokens`: opaque token tables
- `feature_flags`: PK is `key text` (e.g. `stockout_alerts`); no random component

### Junction tables (composite PK, no `id` column at all)

- `user_branches` — PK `(user_id, branch_id)`
- `user_roles` — PK `(user_id, role)`
- `service_eligible_products` — PK `(tenant_id, service_id, product_id)` (currently surrogate; **fix**)
- `service_bundle_items` — PK `(tenant_id, bundle_service_id, item_service_id)` (currently surrogate; **fix**)
- `inventory_lot_balances` — PK `lot_id` (1:1 with `inventory_lots`)

---

## Bugs to fix during the rewrite

| Bug                                                                                                                        | Location              | Fix                             |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------- |
| `clinical_order_schedule_changes.id` CHECK regex matches `\.CLI-…`                                                         | `0003_invariants.sql` | Drop — table now bigserial-only |
| `feature_flags.id` CHECK regex matches `\.FF-…`                                                                            | `0003_invariants.sql` | Drop — PK is `key` text         |
| `AR-` prefix for `approval_requests` collides with SQL "AR"                                                                | `displayId.ts` ✓ done | Renamed to `APR_`               |
| `TAGD-` 4-letter prefix                                                                                                    | `displayId.ts` ✓ done | Renamed to `TGD_`               |
| `SOTI-` 4-letter prefix                                                                                                    | `displayId.ts` ✓ done | Renamed to `STI_`               |
| `INVTX-` 5-letter prefix                                                                                                   | `displayId.ts` ✓ done | Renamed to `MVT_`               |
| `I-` / `P-` 1-letter prefixes (txn items / payments)                                                                       | `displayId.ts` ✓ done | Renamed to `TXI_` / `PMT_`      |
| `OR-` 2-letter prefix for receipts                                                                                         | n/a — column dropped  | `receipt_no` deferred           |
| 11 dead prefixes in type union (`SUP`, `PPL`, `PLT`, `PPR`, `TL`, `IVM`, `FF`, `LBO` old form, `PRD`, `SBI`, `PAL`, `PCN`) | `displayId.ts` ✓ done | Removed from type union         |

---

## Audit findings to fold into the rewrite

From the 2026-05-18 audit:

| Severity | Finding                                                                                                                                                                                    | Action                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HIGH     | Junction tables `user_branches`, `user_roles`, `service_eligible_products`, `service_bundle_items` use surrogate `text id` PK + unique index on natural keys                               | Drop `id` column; use `primaryKey({ columns: [...natural keys] })`                                                                                                                                     |
| HIGH     | `inventory_movements` lacks denormalized `branch_id` — branch-level inventory reports require 2-table join through `inventory_lots`                                                        | Add `branch_id bigint NOT NULL` populated from parent lot at insert                                                                                                                                    |
| HIGH     | `lab_orders` lacks denormalized `branch_id` — same reason                                                                                                                                  | Add `branch_id bigint NOT NULL` populated from `clinical_orders.branch_id`                                                                                                                             |
| MED      | Missing `(tenant_id, created_at)` indexes on `patient_allergies`, `patient_conditions`, `patient_emergency_contacts`, `patient_external_immunizations`, `adverse_events`, `bite_incidents` | Add composite indexes                                                                                                                                                                                  |
| MED      | Operational tables (`transactions`, `encounters`, `clinical_orders`, `appointments`, `claims`) lack partial `WHERE deleted_at IS NULL` indexes                                             | Add partial indexes on hot status filters                                                                                                                                                              |
| MED      | `domain_events` not partitioned (audit_logs is)                                                                                                                                            | Partition by month, 12–24mo retention                                                                                                                                                                  |
| MED      | JSONB columns `encounters.specialty_data`, `bite_incidents.bite_details`, `lab_orders.result_data` will be aggregated for analytics                                                        | Add generated columns for the keys that get aggregated (e.g. `bite_category` from `bite_details->>'who_category'`) — defer until first analytics dashboard surfaces the need, but document the pattern |
| LOW      | Polymorphic FK on `attachments` (`owner_type`/`owner_id`) and `consents` (`scope_ref_type`/`scope_ref_id`) lacks orphan detection                                                          | Acceptable for now; consider exclusive-arc refactor later (separate worker, separate session)                                                                                                          |

---

## Implementation plan — orchestrate-ready

Run as a `/orchestrate` session with these waves. Each worker forks from coordinator HEAD.

### Wave 1 — Schema + Migrations (sequential, single worker)

**Worker W1:** Rewrite `apps/backend/src/shared/db/schema.ts`.

- Every entity table: `id bigserial PRIMARY KEY` + `display_id text NOT NULL UNIQUE`.
- Every FK column: `bigint('xxx_id').references(() => parent.id)`.
- Drop `text id` from junction tables; use composite PK.
- Add `branch_id` to `inventory_movements` and `lab_orders`.
- Add `mrn`, `visit_no`, `transfer_ref`, `claim_no`, `case_no`, `incident_no`, `receipt_no`, `booking_ref`, `recall_no` columns where the handover lists them.
- Add the missing `(tenant_id, created_at)` indexes.
- Add partial indexes `WHERE deleted_at IS NULL` to the 5 listed operational tables.
- Keep all enums, citext, jsonb, tsvector typing intact.
- Reference: current schema.ts is 2,457 lines, expect ~2,300 new lines.

**Hard rules for W1 (DO NOT VIOLATE):**

- `tenants.id` stays `text` — it IS the slug (`SVX`). Every FK to `tenants.id` stays `text`. The tenant slug is what JWT/subdomain/header carries.
- `feature_flags` PK is `key text` (the flag name, e.g. `stockout_alerts`). No bigserial. No display_id.
- Polymorphic `entity_id` columns: keep `text` storing **display_id** on `audit_logs`, `approval_requests`, `attachments`, `consents`. Switch to `bigint` on `inventory_movements` and `notifications`. Audit trigger writes a companion `entity_display_id text` column on `audit_logs` for join-free readability.
- Self-referential FKs (`users.created_by_id`, `branches.created_by_id`, `refresh_tokens.replaced_by_id`, `service_categories.parent_id`, `standing_order_templates.supersedes_id`, `patients.merged_into_id`) — declare the column without `.references(...)` in the table block and add the FK in W2's baseline SQL after both tables exist.
- Generated columns (`transactions.amount_outstanding`, `patients.full_name`) — declare as plain typed columns in Drizzle; the GENERATED clause stays in baseline SQL.

**Verification W1:** `pnpm --filter @surevax/backend typecheck` MUST pass after schema rewrite.
(Module callers will be broken; that's expected — wave 2 fixes them.)

**Worker W2:** Regenerate `apps/backend/drizzle/0000_initial.sql` to match.

- Easiest path: `pnpm drizzle-kit generate` (if config allows) after schema.ts lands.
- Otherwise hand-write to match new schema.
- Add format CHECK constraints into the baseline rather than `0003_invariants.sql`:
  - `display_id ~ '^[A-Z]{3}_[0-9A-HJKMNPQRSTVWXYZ]{8}$'` on each entity table.
  - Drop the old per-table prefix-specific CHECKs entirely.

**Worker W3:** Update `0003_invariants.sql` + RLS + audit trigger.

- Drop every `*_id_format` CHECK (they're now in baseline as `*_display_id_format`).
- Keep `branches_code_format` CHECK on `branches.code`.
- Drop the relaxed `transactions_id_format` regex (TXN ID format now uniform).
- Drop the obsolete `clinical_order_schedule_changes` and `feature_flags` CHECKs.
- **Rewrite the GIST EXCLUDE constraint on `appointments`** (currently in `0003_invariants.sql`): the `WITH =` operator class for `branch_id` and `provider_id` was `text_ops`; change to default `int8_ops` (`btree_gist` extension needs the int8 variant — verify it's installed).
- **Audit every RLS policy in `0001_extensions_and_rls.sql`** for `text`-vs-`bigint` casts. The GUC `current_setting('app.current_branch_id')` returns text; comparisons against bigint columns need `::bigint` cast. Missing the cast returns zero rows silently, not an error. Same for `app.current_user_id`.
- **Rewrite the `audit_log_changes()` trigger function** in `0002_audit_and_redaction.sql`: it currently generates audit row IDs like `AUD-{year}-{10 hex}`. Switch `audit_logs.id` to bigserial-only; drop the in-trigger ID generation; add an `entity_display_id text` column populated from the parent row's display_id so audit reports never need a join.
- **Trim the `audit_action` enum.** Since the trigger is being rewritten, fold in the audit-cleanup foundation from `docs/handovers/2026-05-18-audit-log-redesign.md` §1. Drop `READ` (dead — `phi_access_log` covers it). Add `LOGIN_FAILED`, `BREAK_GLASS`, `PERMISSION_CHANGE`, `CONFIG_CHANGE`, `EXPORT`, `PRINT`, `AUDIT_ACCESS`. App-side call sites are out of scope for W3 — that lives in the audit-log-redesign handover.
- **Trim the audit trigger attachment list.** Drop these 5 tables from the `FOREACH t IN ARRAY ARRAY[...]` block in `0002_audit_and_redaction.sql`: `notifications` (noise, covered by `domain_events`), `service_eligible_products` and `service_bundle_items` (config junctions; parent service_catalog audit covers context), `clinical_order_schedule_changes` (itself purpose-built schedule audit), `patient_tags` (auto-expiry noise; audit `tag_definitions` only). Net: ~45 audited tables instead of 50.
- **Add `provision_tenant_counters(slug text)` SQL function** that issues `CREATE SEQUENCE mrn_seq_<slug> OWNED BY NONE`. Call from the seed (`SELECT provision_tenant_counters('svx')`) and from the future tenant-onboarding code path.

### Wave 2 — Helpers + Seed (sequential, can run after W1)

**Worker W4:** Update `apps/backend/src/shared/db/seed.ts` and any sub-seed files.

- Replace `randomId('PAT')` → `displayId('PAT')`, etc. for every call site.
- Tenant seed: `id: 'SVX'`, drop `TEN-SUREVAX`.
- Branch seed: `code: 'HST'` (or whatever), `display_id` computed as `${slug}.${code}`.
- Service catalog seed: PK = raw code (`ARVPEP_IM`), no prefix wrapper.
- Patient seed: add `mrn` allocated via `SELECT nextval('mrn_seq_svx')` → `formatMrn(seq)`.
- **Restructure seed flow to capture returned bigints.** Every `tx.insert(...).values(...)` becomes `.values(...).returning()` and the caller passes the returned bigint forward as the FK to dependent inserts:

  ```ts
  const [tenant] = await tx.insert(tenants).values({ id: 'SVX', ... }).returning()
  await tx.execute(sql`SELECT provision_tenant_counters(${tenant.id})`)
  const [branch] = await tx.insert(branches).values({ tenantId: tenant.id, code: 'HST', displayId: branchDisplayId('SVX','HST'), ... }).returning()
  const [user] = await tx.insert(users).values({ tenantId: tenant.id, primaryBranchId: branch.id, displayId: displayId('USR'), ... }).returning()
  ```

- Seed test credentials (`docs/ai-context/06-CLINICAL-WORKFLOWS.md` lists them) keep the same emails/passwords/PINs — only the IDs change.

**Verification W4:** `pnpm --filter @surevax/backend run seed` MUST complete against a fresh DB. (Use `pnpm setup --force` to recreate.)

### Wave 3 — Module updates (PARALLEL, one worker per module, max 6 per wave)

For each of these modules, the worker:

1. Updates `db.ts` to use `displayId(...)` from the new helper.
2. Updates FK column references — if a route accepts a display_id from the URL,
   the service must `WHERE display_id = $1` first to resolve to bigserial PK,
   then use bigint FKs internally.
3. Updates Zod schemas in routes to use `displayIdSchema` or `prefixedDisplayIdSchema('PAT')`.
4. **Never leaks internal bigint to API responses.** Drizzle `.select()` projections must alias the bigint `id` to a hidden internal name (or just exclude it) and surface `display_id` as the public `id` field, OR the service layer renames the response key before returning:

   ```ts
   .select({ id: patients.displayId, name: patients.lastName, ... })
   ```

5. **Emits display_id (not bigint) in domain event payloads.** Every `publishEvent({...})` payload that includes a patient/transaction/encounter ref uses the `display_id` string.
6. Runs `pnpm --filter @surevax/backend typecheck` before reporting done.

Modules (group as 6-worker waves):

**Wave 3a:** patients, encounters, clinical_orders, transactions, appointments, inventory_lots

**Wave 3b:** standing_orders, scheduled_orders, payments, claims, lab_orders, consents

**Wave 3c:** users, auth, refresh_tokens, branches, service_catalog, service_categories

**Wave 3d:** payer_profiles, attachments, notifications, adverse_events, bite_incidents, inventory_transfers

**Wave 3e:** staff_time_logs, cash_drawer, day_summary, product_recalls, approvals, audit

**Wave 3f:** arrivals, admin (users/branches/approvals/notificationTemplates/claims), notification_templates

### Wave 4 — Frontend + docs (small, single worker)

**Worker W5:** Frontend api.ts updates.

- Most types already use `string` — no change for those.
- Anywhere code parses a display ID to extract year/branch (e.g. receipt header
  showing `TXN-2026-…`), switch to reading `created_at` and `branch.code`.
- Update any `idSchema` import to `displayIdSchema` from `@surevax/shared`.

**Worker W6:** Documentation.

- Update `apps/frontend/CLAUDE.md` if it references IDs.
- Update `.claude/rules/gotchas.md` "Display IDs" section to reflect the new shape.
- Update `.claude/rules/patterns.md` if it references the old helper API.
- Update relevant skill files: `parallel-work`, `pr-review`, `gotchas` (already updated in foundation commit).

### Wave 5 — Verification (single worker)

**Worker W7:** End-to-end smoke.

- `pnpm setup --force` (rebuilds DB from migrations + seed).
- `pnpm --filter @surevax/backend typecheck`.
- `pnpm --filter @surevax/frontend build`.
- Login flow + create patient + create encounter + create order curl smoke.
- Login flow via preview tools (frontend rendering check).
- Report any regressions; coordinator dispatches fix-up workers.

---

## Gotchas every worker must read before starting

These bit us before during the schema-v2 cutover or are specific to this redesign.
Brief into every worker prompt.

### Concurrency

- **MRN concurrency**: never `SELECT MAX(mrn_seq)+1` — always `SELECT nextval('mrn_seq_<slug>')` inside the same transaction as the INSERT. The audit trigger requires `set_config('app.current_tenant_id', ...)` first, but `nextval` does not need the GUC since the sequence is unaudited.
- **display_id collision retry**: on `error.code === '23505'` with the `*_display_id_key` unique index, regenerate `displayId(prefix)` and retry up to 3× inside the same transaction. Essentially never triggers (40-bit entropy) but the path must exist.

### Postgres-js bigint serialization

`postgres-js` returns `bigint` columns as JavaScript **strings** by default to avoid precision loss past 2^53. Three options for workers; pick the same one across the codebase:

1. **Coerce to number** at the driver layer (`transform: { types: { 20: postgres.bigint } }`) — safe up to 2^53 ≈ 9 quadrillion. Choose this for clinic-scale.
2. Type all IDs as `string` throughout TypeScript — works but feels weird since they're numeric.
3. Use the `bigint` JS type — overkill and clutters comparisons.

Recommendation: option 1, configured in `apps/backend/src/shared/db/client.ts`. Document the choice; flag any equality comparison against a number literal (`if (row.id === 42)` vs `if (row.id === '42'`).

### Drizzle quirks

- **`drizzle-kit generate`** reads the schema and emits a fresh migration. After W1's schema.ts lands, prefer hand-writing baseline.sql to match — the generator may reformat unrelated constraints, omit GENERATED clauses, or emit DROP/CREATE for indexes that haven't actually changed. Diff carefully before committing.
- **`bigint('xxx_id', { mode: 'number' })`** is what you want on FK columns if you went with the `transform` driver coercion above. Without `mode: 'number'`, Drizzle types the column as `string`.
- **`bigserial('id')`** maps to Postgres `bigserial` which is `bigint NOT NULL DEFAULT nextval('...')`. Drizzle gives it `mode: 'number'` automatically on most versions — verify the version's behaviour and override if needed.
- **`.returning()`** on inserts is mandatory in the seed and in service code that needs the new bigint to chain into a dependent insert. Without it the insert returns `void`.

### Auth + middleware

- **JWT payload** carries `userId` (display_id string), `tenantSlug`, `branchCode` (NOT branch_id). Auth middleware resolves `branchCode` to bigint at request time and writes both `req.user.id` (bigint) and `req.user.displayId` (string).
- **`set_config('app.current_user_id', ...)`** in tenant-scoped transactions: the value is whatever the GUC is read as. RLS policies must `::bigint` cast. Same for `app.current_branch_id`.
- **`apiFetch`**'s 401→refresh→retry path: the refresh response body contains user info. Make sure it still keys on `displayId`/`tenantSlug`, never internal bigint.

### Audit + events

- **`audit_logs.entity_id` is text** holding display_id; `entity_display_id` is denormalized via the trigger so reports never join. The trigger needs the parent's display_id, which it gets from the NEW row's `display_id` column. Tables without a display_id (junctions, status_history) write `entity_id` as the bigint cast to text + leave `entity_display_id` NULL.
- **`audit_logs.id`** is bigserial — no more `AUD_…` format. Drop all app code that read or wrote audit log IDs by hand.
- **Domain event payloads** must use display_id strings. Internal bigints are forbidden in JSONB payloads — they're useless to consumers outside Postgres.

### Self-references + ordering

Tables with self-FKs declare the column **without** `.references(...)` in the Drizzle block; the FK is added at the bottom of `0000_initial.sql` after both endpoints exist. Affected tables:

- `users.created_by_id → users.id`
- `branches.created_by_id → users.id` (circular: needs users to exist first too)
- `refresh_tokens.replaced_by_id → refresh_tokens.id`
- `service_categories.parent_id → service_categories.id`
- `standing_order_templates.supersedes_id / superseded_by_id`
- `patients.merged_into_id → patients.id`
- `patients.potential_duplicate_of_id → patients.id`

### GIST EXCLUDE on appointments

Double-booking prevention is `EXCLUDE USING gist (tenant_id WITH =, provider_id WITH =, branch_id WITH =, during WITH &&) WHERE deleted_at IS NULL`. After PK change:

- `tenant_id` stays text → `WITH =` keeps `text_ops`.
- `provider_id`, `branch_id` switch to bigint → `WITH =` needs `int8_ops` (or default). `btree_gist` ships int8 support but worker must verify the extension is installed (`CREATE EXTENSION IF NOT EXISTS btree_gist`).

### Generated columns

Two `GENERATED ALWAYS AS … STORED` columns survive unchanged:

- `transactions.amount_outstanding GENERATED ALWAYS AS (GREATEST(net_amount - amount_paid, 0)) STORED`
- `patients.full_name GENERATED ALWAYS AS (...)` STORED (in `0005_modern_pg.sql`)

Drizzle has no native syntax for these — declare as plain typed columns in schema.ts; the GENERATED clause lives in baseline SQL. App code must never INSERT/UPDATE these columns.

### R2 attachment paths

`attachments.r2_key` may bake display_id into the object key (e.g. `tenant/SVX/patients/PAT-K9MX3VQ2P5/consent.pdf`). Audit `apps/backend/src/modules/attachments/` and any R2 upload code paths. New uploads use the new format; old objects become orphaned but no live data exists yet, so they get wiped with `pnpm setup --force`.

### Other quiet traps

- **`tenants.id` stays text — DO NOT change it.** Some workers may "helpfully" make it bigserial for consistency. Block this in PR review.
- **`feature_flags` PK is `key text`** — also no bigserial.
- **Test fixtures**: every `*.test.ts` hardcoded ID needs updating to the new format. `pnpm test` will surface them in Wave 5.
- **Pino redact paths**: `apps/backend/src/shared/observability/logger.ts` has redact paths referencing field names like `id`, `email`. If response shape now uses `displayId`, add the new path to the redact list.
- **TanStack Query keys** change from `['patient', 'PAT-…']` to `['patient', 'PAT_…']` — auto-handled since nothing persists React Query state. Bookmarks break in dev; acceptable.

---

## Out of scope

These were considered but explicitly deferred:

- **UUIDv7 PKs** — bigserial chosen as the sweet spot; UUIDv7 is overkill for clinic scale.
- **Polymorphic-FK exclusive-arc refactor** — separate audit item; deferred to its own session.
- **Generated columns for JSONB** — promote reactively when first analytics dashboard surfaces a need.
- **FHIR vocabulary alignment** — naming cleanup project; separate session.
- **CDC pipeline to ClickHouse/DuckDB** — Phase 3 work; not needed yet.

---

## References

- Foundation commit: `apps/backend/src/shared/utils/displayId.ts` + `packages/shared/src/utils/displayId.ts`
- Audit report: this document, sections above
- Industry research: Stripe-style prefixed IDs, two-tier internal/public PK split, FHIR resource alignment
- Original ID gotcha (now outdated): `.claude/rules/gotchas.md` § "Display IDs are tiered text"
- Migration baseline to regenerate: `apps/backend/drizzle/0000_initial.sql`
- Invariants to slim down: `apps/backend/drizzle/0003_invariants.sql`
