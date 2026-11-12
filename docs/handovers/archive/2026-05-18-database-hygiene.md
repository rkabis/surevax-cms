# Database Hygiene & Compliance — Handover

**Date:** 2026-05-18
**Status:**

- **Track A (DB hygiene): ✅ DONE 2026-05-19.** Session timeouts landed in
  supplemental migration `0008` (A1). Inventory FEFO `FOR UPDATE SKIP LOCKED`
  retypes shipped in `apps/backend/src/modules/inventory/fefo.ts` (A3).
  Clinical sanity CHECKs extended in `0003_invariants.sql` (A4).
  Migration-safety + cascade + Drizzle-limitations patterns folded into
  `.claude/rules/patterns.md` (A2/A5/A6) by W4.B.
- **Track B (compliance prep):** untouched. Pick up when prioritized.
- **Track C (Phase 2 readiness):** untouched. Pick up when a customer signs.

**Driver:** 2026-05-18 schema audit + best-practice review surfaced a backlog of operational, compliance, and Phase-2-readiness concerns that don't fit the ID or audit handovers but matter before live patient data lands.

## Relationship to other handovers

| Handover                                                               | What it covers                                                                                                          | This handover defers to it                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`2026-05-18-id-redesign.md`](archive/2026-05-18-id-redesign.md)       | Two-tier PKs, FK retyping, helper API, MRN sequences, GIST EXCLUDE rewrite, polymorphic FK shape, audit trigger rewrite | Generated columns, self-ref FK ordering, MRN concurrency, tenant counters, audit `entity_display_id` denormalization |
| [`2026-05-18-audit-log-redesign.md`](2026-05-18-audit-log-redesign.md) | HIPAA-aligned action enum, hash chain, 10yr retention, app-side call sites                                              | All audit-log work, including the 0007 retention proc edit                                                           |

If you find yourself touching a file already in scope for one of those, fold the change in there instead of duplicating it.

---

## Three tracks

This handover groups 17 items into three execution tracks based on when they need to ship.

### Track A — Database hygiene (single PR or small wave, near-term)

Cheap, non-compliance, "do it before it bites" items. Most are one-line config or single-table changes. Bundle into one PR after ID + audit redesigns land.

### Track B — Compliance prep (separate handover when prioritized)

DPA / NPC-aligned work that must land **before any live patient data hits production**. Today there is no live data so this is not urgent, but the runway shrinks fast once Phase 2 onboards.

### Track C — Phase 2 readiness (separate handover when a customer signs)

Connection pooling, cross-tenant operations, read-replica planning. Defer until concrete Phase-2 demand exists.

---

## Track A — Database hygiene

### A1. Session timeouts (single SQL migration)

**Problem:** No global `statement_timeout`, `lock_timeout`, or `idle_in_transaction_session_timeout` set. A single runaway query or abandoned transaction can stall the entire backend connection pool indefinitely.

**Files:** New supplemental SQL migration (e.g. `apps/backend/drizzle/0008_session_timeouts.sql`) OR Railway service env vars via the Postgres image.

```sql
ALTER DATABASE :db_name SET statement_timeout = '30s';
ALTER DATABASE :db_name SET lock_timeout = '5s';
ALTER DATABASE :db_name SET idle_in_transaction_session_timeout = '60s';
```

Worker code that legitimately needs longer (FEFO bulk picks, audit partition pruning) raises the timeout locally per-transaction: `SET LOCAL statement_timeout = '120s'`.

**Verification:** boot a fresh DB; check `SHOW statement_timeout`; run a query that sleeps 60s and confirm it's killed.

### A2. Migration safety patterns (docs only, no SQL)

**Problem:** Phase 2 customers will have populated DBs; future schema changes need online-safe patterns. The current redesign waves can be destructive because no live data exists. Once that changes, we need documented patterns.

**Files:** Add a "Migration safety" section to `.claude/rules/patterns.md`.

Document these rules:

- **`CREATE INDEX` → always `CREATE INDEX CONCURRENTLY`** on populated tables in production migrations. Drizzle does NOT emit this — hand-write in supplemental SQL.
- **`ALTER TABLE ... ADD COLUMN col TYPE NOT NULL DEFAULT ...`** with a function default rewrites every row. Use the 3-step pattern instead: `ADD COLUMN col TYPE NULL` → backfill in batches → `ALTER COLUMN col SET NOT NULL`.
- **`ALTER COLUMN ... TYPE`** rewrites the column. For text→bigint type changes on populated FK columns, use shadow-column-then-swap.
- **`lock_timeout` per session for risky migrations**: `SET lock_timeout = '5s'; ALTER TABLE ...` — fails fast instead of holding the table hostage.
- **Drop columns/constraints in two PRs**: PR1 stop using it in app code; PR2 drop it in DB. Never both in the same release.

**Verification:** docs-only change. Worth pairing with a one-time review of `0000_initial.sql` + supplemental migrations to confirm every `CREATE INDEX` was on an empty table (none exist on a fresh setup, so it's moot for the baseline).

### A3. Inventory FEFO concurrency (`FOR UPDATE SKIP LOCKED`)

**Problem:** Two cashiers picking from the same lot at the same time can double-deduct. Today's `pickAndDeductFefo` helper may not use row-level locking with SKIP semantics.

**Files:** `apps/backend/src/modules/inventory/fefo.ts` (and any caller).

Required pattern:

```sql
SELECT id, quantity_on_hand
FROM inventory_lots
WHERE branch_id = $1
  AND <eligible-for-service-id condition>
  AND quantity_on_hand > 0
  AND expires_at > now()
  AND deleted_at IS NULL
ORDER BY expires_at ASC, received_at ASC
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

`SKIP LOCKED` makes concurrent pickers fall through to the next eligible lot instead of queueing on the same row. `FOR UPDATE` reserves the row for the current transaction so the subsequent UPDATE (decrement quantity_on_hand) doesn't race.

**Verification:** Open two psql sessions; both attempt `pickAndDeductFefo` simultaneously with the same service+branch; observe one grabs lot A, the other grabs lot B; final quantities match expected.

**When:** Fold into Wave 3d (inventory) of the ID redesign rather than a standalone change.

### A4. Clinical sanity CHECK constraints

**Problem:** No DB-level guard against impossible clinical values. App-layer validation catches most cases, but background-job inserts and direct DB writes can introduce corruption.

**Files:** `apps/backend/drizzle/0003_invariants.sql` (extend the existing CHECK block).

Add CHECKs on clinical columns with natural bounds:

```sql
ALTER TABLE encounter_vitals
  ADD CONSTRAINT encounter_vitals_temp_range
    CHECK (temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45),
  ADD CONSTRAINT encounter_vitals_bp_positive
    CHECK ((bp_systolic IS NULL AND bp_diastolic IS NULL)
        OR (bp_systolic > bp_diastolic AND bp_diastolic > 0)),
  ADD CONSTRAINT encounter_vitals_weight_positive
    CHECK (weight_kg IS NULL OR weight_kg > 0),
  ADD CONSTRAINT encounter_vitals_pulse_range
    CHECK (pulse_bpm IS NULL OR pulse_bpm BETWEEN 20 AND 250);

ALTER TABLE inventory_lots
  ADD CONSTRAINT inventory_lots_quantity_non_negative
    CHECK (quantity_on_hand >= 0);  -- if not already there

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive
    CHECK (amount > 0);

ALTER TABLE patients
  ADD CONSTRAINT patients_dob_sane
    CHECK (date_of_birth IS NULL OR date_of_birth > '1900-01-01');
```

Spec the full list with clinical input before writing — these are starting points.

**When:** Pair with the inventory module update (Wave 3d ID redesign), since A3 + A4 are both inventory-adjacent.

### A5. Cascade-semantics standardization

**Problem:** FK cascade behaviour is inconsistent — some FKs are `cascade`, most are `no action`. Worth a one-time audit to align with intent.

**Files:** `apps/backend/drizzle/0000_initial.sql` (or `0003_invariants.sql` if FK is added there).

Convention to apply:

| FK type                                                    | onDelete                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| Junction tables (`user_branches`, `user_roles`) → entity   | `cascade`                                                       |
| Status-history → parent entity                             | `cascade`                                                       |
| Audit / event tables → any entity                          | `no action` (audit outlives the row)                            |
| Child entity → parent (e.g. `encounters.patient_id`)       | `restrict` (deny delete if children exist; soft-delete instead) |
| Sub-record → parent (e.g. `encounter_vitals.encounter_id`) | `cascade` (encounter delete cascades)                           |
| FK to lookup tables (services, payers)                     | `restrict`                                                      |
| FK to optional refs (e.g. `encounters.appointment_id`)     | `set null`                                                      |

Map every FK in `schema.ts` against this table; fix mismatches.

**When:** Post-ID-redesign cleanup. One PR after the dust settles.

### A6. Postgres-js bigint settings + Drizzle limitations doc

**Problem:** Drizzle ORM has known gaps (GENERATED columns, EXCLUDE constraints, partitioning, RLS, triggers, table comments). Workers keep rediscovering these.

**Files:** Add a "Drizzle limitations" section to `.claude/rules/patterns.md`. List the features Drizzle doesn't express and the canonical workaround for each.

Settings to lock in `apps/backend/src/shared/db/client.ts`:

```ts
const sql = postgres(connectionUrl, {
  max: 10, // per-instance connection cap
  idle_timeout: 30,
  max_lifetime: 60 * 60,
  // Coerce bigint → JS number (safe up to 2^53 ≈ 9 quadrillion). See
  // gotchas.md "Postgres-js bigint serialization" — the ID redesign
  // baked the decision in.
  types: {
    bigint: postgres.BigInt, // returns native bigint
  },
})
```

**When:** Either bundle into A1's session-timeouts PR, or alongside the ID redesign module updates.

---

## Track B — Compliance prep (separate handover when prioritized)

### B1. DPA / NPC at-rest encryption decision

**Problem:** PH Data Privacy Act classifies health data as Sensitive Personal Information. NPC guidance expects either column-level encryption OR documented compensating controls. Today the SureVax DB has clinical notes, diagnoses, vitals, and PII in plaintext columns. Railway's underlying disk is AWS EBS-encrypted, which is the typical "compensating control" answer — but undocumented.

**Two paths:**

- **B1a. Document Railway's at-rest encryption as the SPI control.** Cheapest. Sufficient for NPC under non-genomic clinical data scope. Write `docs/compliance/dpa-controls.md` capturing the decision + the supporting evidence (Railway docs, AWS EBS encryption attestation).
- **B1b. Column-level encryption via `pgcrypto`** on the most sensitive fields (PhilHealth ID, government IDs, free-text SOAP notes). Defeats DB-admin "I selected from the table" attack vectors. Breaks search/joins on encrypted columns. Worth doing if NPC audit imminent OR if you offer self-hosted deployments.

**Recommendation:** B1a now. B1b only if compliance posture changes.

**When:** Before any live patient data. Today is fine.

### B2. Right-to-erasure procedure

**Problem:** DPA gives data subjects the right to request deletion of their personal data. Schema has `deletion_requested_at` + `scheduled_purge_at` columns on `patients`, but no procedure to actually purge.

**Required behaviour:**

- A `purge_patient(patient_display_id)` SQL function that:
  - Cascades to clinical/financial children where the law allows
  - **Anonymizes** financial records that must be retained for BIR (transactions, payments, claims — 7-year BIR retention) — scrub PII, keep totals + dates
  - Removes attachments from R2 (cross-system delete)
  - Writes an audit row (`action = 'DELETE', metadata.reason = 'dpa_erasure'`)
  - Honors retention conflicts: clinical records typically retained 10 years post-encounter under PH medical-records rules
- A nightly job that processes `patients` rows where `scheduled_purge_at < now()`
- A request workflow (admin endpoint or NPC complaints handler) that sets `deletion_requested_at` + schedules a purge respecting the legally-required retention window

**Files:** `apps/backend/src/modules/admin/dpa.ts` (new); supplemental SQL function; new worker in `apps/backend/src/workers/dpaPurger/`.

**Risk to flag:** purge is irreversible and one wrong query wipes a patient cohort. Build with dry-run flag, audit every purge, and gate behind multi-approver workflow (use existing `approval_requests` infra).

**When:** Phase 2 with first live tenant. Before then, manual NPC requests are handled by deleting the dev DB.

### B3. Backup verification + DR drill

**Problem:** Railway has automated daily backups + PITR within the retention window, but no team has actually restored a backup. Unverified = unknown.

**Required:**

- Document RPO (Recovery Point Objective — max acceptable data loss in time) and RTO (Recovery Time Objective — max acceptable downtime).
- Suggested targets for Phase 1 single-clinic: RPO 24h, RTO 8h. Phase 2 multi-tenant: RPO 1h, RTO 1h.
- Quarterly restore drill: pick a recent backup, restore to a staging DB, run smoke tests, time the operation, document gaps.
- Verify WAL retention window on Railway plan covers your RPO target.

**Files:** `docs/runbooks/disaster-recovery.md` + scheduled calendar reminder for quarterly drills.

**When:** Before live data. One-time drill effort then ongoing quarterly cadence.

### B4. Effective-dated extension to payer_contracts + tag_definitions

**Problem:** `service_prices` already has `effective_from` + `effective_to` (good pattern). `payer_contracts` and `tag_definitions` change over time too but only have `created_at`/`updated_at` — historical price/contract reconstruction is impossible after edits.

**Files:** `apps/backend/src/shared/db/schema.ts` (extend two tables); supplemental SQL for backfill.

Add `effective_from timestamptz NOT NULL DEFAULT now()`, `effective_to timestamptz NULL`. Inserts that supersede an existing contract: set old row's `effective_to = now()`, insert new row with `effective_from = now()`. Queries filter `now() BETWEEN effective_from AND COALESCE(effective_to, 'infinity')`.

**When:** Low priority. Q3+ 2026, when financial reporting needs historical reconstruction.

---

## Track C — Phase 2 readiness (separate handover when customer signs)

### C1. Connection pooling + Railway connection limits

**Problem:** Railway Postgres has a 100–200 hard connection limit depending on plan. Each backend instance opens a pool. With multiple instances × multiple tenants, the cap is reachable.

**Required:**

- Set `max: 10` per pool in postgres-js (already may be set — verify).
- Add PgBouncer (transaction pooling) in front of Railway DB when concurrent request count > `max * instances`.
- Set `idle_in_transaction_session_timeout = 60s` in postgres config (covered by Track A1).
- Monitor connection-count utilization (Railway dashboard); alarm when > 70% capacity.

**Files:** Add PgBouncer to Railway service config; document in `railway-ops` skill.

**When:** When Phase 2 customer signs OR when you observe connection pressure in Phase 1.

### C2. Tenant-aware date boundary handling

**Problem:** "Today's transactions" queries currently rely on JS `Date` in app code. The default tenant tz is `Asia/Manila` (in `tenants.timezone` column), but no app code reads it for date-boundary queries.

**Required:**

- A `tenantDateBoundary(tenantId, day): { startUtc, endUtc }` helper that reads `tenants.timezone` and computes the local-day boundary in UTC.
- Audit every endpoint that filters "today's X" — day_summary, transactions list with "today" toggle, encounters by date, appointments today. Replace JS-Date math with the helper.
- SQL pattern for tenant-local aggregations: `date_trunc('day', ts AT TIME ZONE tenant.timezone)`.

**Files:** `apps/backend/src/shared/lib/tenantDate.ts` (new); audit ~10 endpoints across day_summary, transactions, encounters, appointments modules.

**When:** When Phase 2 onboards a non-PH tenant OR a PH tenant in a non-Manila branch (rare). Defer.

### C3. Read replica planning

**Problem:** Single-DB writes + reads is fine at clinic scale. At ~10 concurrent active branches with heavy reporting, reporting queries start interfering with operational queries.

**Required:**

- Identify the heavy reporting queries (day_summary, claims reports, inventory snapshots, audit log queries).
- Add Railway streaming read replica (postgres-native, low-effort).
- Add a read-only Drizzle client routing reporting endpoints to the replica.
- Replication lag must be < 5s for "today" queries to be accurate; > 5s acceptable for monthly reports.

**Files:** `apps/backend/src/shared/db/client.ts` — separate `dbReadOnly` export; route reporting modules to it.

**When:** When observed query interference shows up. Phase 3, not Phase 2.

### C4. Filipino name handling + fuzzy search optimization

**Problem:** Filipino names have compound surnames (`de la Cruz` ≈ `Dela Cruz`), suffixes (`Jr.`, `III`), Chinese-Filipino dual surnames (`Tan-Reyes`), Spanish-style maternal middle names. `pg_trgm` handles typos but not these normalizations.

**Required:**

- Talk to clinic staff: where does search actually fail? Optimize for the real pain.
- If duplicate-detection is the pain: add a `normalized_name` GENERATED column (lowercase, no spaces/hyphens/punctuation), index trgm on it.
- If phonetic matching is the pain: enable `fuzzystrmatch` extension; add Soundex/Metaphone index.
- Document the policy: "Names are searched on normalized form; staff entry preserved as-is."

**Files:** Schema change adding `normalized_name`; modify search query in `apps/backend/src/modules/patients/db.ts`.

**When:** When clinic staff complain. Don't preempt.

---

## Items NOT in this handover

Already covered elsewhere; cross-reference and skip:

| Concern                                           | Where it's covered                              |
| ------------------------------------------------- | ----------------------------------------------- |
| Audit log enum + table list trim                  | ID redesign W3                                  |
| Audit log hash chain                              | Audit redesign W-B                              |
| Audit log 10yr retention                          | Audit redesign W-C                              |
| MRN sequence per tenant                           | ID redesign W1 + W4                             |
| Polymorphic FK shape (text vs bigint)             | ID redesign locked decision #9                  |
| Generated columns (amount_outstanding, full_name) | ID redesign W1 hard rules                       |
| Self-referential FK ordering                      | ID redesign W1 hard rules                       |
| GIST EXCLUDE operator class change                | ID redesign W3                                  |
| audit_log_changes() trigger rewrite               | ID redesign W3                                  |
| Tenant counters table (future BIR receipt_no)     | ID redesign locked decision #6                  |
| Postgres-js bigint serialization                  | ID redesign gotchas section                     |
| Soft delete pattern                               | `.claude/rules/gotchas.md` (already documented) |
| Tenant GUC for audit trigger                      | `.claude/rules/gotchas.md` (already documented) |
| RLS as primary tenant boundary                    | `CLAUDE.md` non-negotiable rule #2              |
| Audit trigger on supplemental SQL UPDATE          | `.claude/rules/gotchas.md` (already documented) |

---

## Execution recommendation

| Track                     | When                                                                                  | Format                                 |
| ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| **A — Hygiene**           | After ID + audit redesigns land. ~1 day.                                              | Single PR, 6 items.                    |
| **B — Compliance**        | Before any live patient data — Q3 2026 at latest. ~3–5 days.                          | Separate handover when ready to start. |
| **C — Phase 2 readiness** | When a concrete Phase-2 customer signs or pressure observed. ~5–10 days across items. | Separate handover when needed.         |

### Track A worker plan (if dispatched today)

Single-worker, sequential:

1. A1 — session timeouts (1 SQL file)
2. A6 — postgres-js settings in `db/client.ts` + Drizzle limitations section in `patterns.md`
3. A2 — migration safety section in `patterns.md`
4. A3 — FEFO `FOR UPDATE SKIP LOCKED` (already folded into ID redesign Wave 3d — verify it lands there; only do here if it didn't)
5. A4 — clinical sanity CHECK constraints (extend `0003_invariants.sql`)
6. A5 — cascade semantics audit (one PR; map every FK in `schema.ts` against the convention table)

Verification per item: `pnpm setup --force` succeeds; backend typecheck passes; existing tests pass.

---

## References

- [`docs/handovers/2026-05-18-id-redesign.md`](archive/2026-05-18-id-redesign.md) — two-tier ID model + W3 audit trigger rewrite
- [`docs/handovers/2026-05-18-audit-log-redesign.md`](2026-05-18-audit-log-redesign.md) — HIPAA-aligned audit cleanup
- [`.claude/rules/gotchas.md`](../../.claude/rules/gotchas.md) — high-frequency gotchas (already covers tenant GUC, audit trigger, CSRF, etc.)
- [`.claude/rules/patterns.md`](../../.claude/rules/patterns.md) — tenant-scoped DB access pattern (Track A2 extends this)
- [PH Data Privacy Act NPC guidance](https://privacy.gov.ph/data-privacy-act/) — for Track B1
- [Strong Migrations community guide](https://github.com/ankane/strong_migrations) — for Track A2 patterns
- [Postgres `idle_in_transaction_session_timeout` docs](https://www.postgresql.org/docs/current/runtime-config-client.html) — for Track A1
