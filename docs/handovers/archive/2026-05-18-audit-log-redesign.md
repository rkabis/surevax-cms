# Audit-Log Redesign — Handover

**Date:** 2026-05-18
**Status:**

- **W3 foundation: ✅ DONE 2026-05-19** (folded into the ID redesign). `audit_action`
  enum trimmed; trigger attachment list trimmed; `audit_logs.id` is bigserial;
  `audit_logs.entity_display_id` column populated by trigger. See
  [`archive/2026-05-18-id-redesign.md`](archive/2026-05-18-id-redesign.md) for the
  shipped commits.
- **Wave A (app-side write call sites):** untouched. `LOGIN_FAILED`, `BREAK_GLASS`,
  `EXPORT`, `PRINT`, `PERMISSION_CHANGE`, `CONFIG_CHANGE`, `AUDIT_ACCESS` still need
  their app-side emit sites wired (3–4 parallel workers across auth / print-export / admin).
- **Wave B (tamper-evidence SHA256 hash chain):** untouched.
- **Wave C (10-year retention enforcement, DPA-aligned):** untouched.
- **Wave D (async ingestion via domain_events):** deferred indefinitely.

**Prereq:** ID redesign W1–W3 must land first — DONE. The new `audit_action` enum values and trimmed attachment list arrive with that work.
**Driver:** Audit-log review on 2026-05-18 found dead `READ` action, missing HIPAA/HITECH-required actions (`LOGIN_FAILED`, `EXPORT`, `PRINT`, `BREAK_GLASS`, `PERMISSION_CHANGE`, `CONFIG_CHANGE`, `AUDIT_ACCESS`), and no tamper-evidence chain.

---

## What the ID redesign already covers (DO NOT re-do)

These items live in `docs/handovers/archive/2026-05-18-id-redesign.md` §W3:

1. `audit_action` enum trim: drop `READ`, add `LOGIN_FAILED`, `BREAK_GLASS`, `PERMISSION_CHANGE`, `CONFIG_CHANGE`, `EXPORT`, `PRINT`, `AUDIT_ACCESS`.
2. `audit_logs.id` becomes bigserial; in-trigger `AUD-{year}-…` ID generation removed.
3. `audit_logs` gains `entity_display_id text` column populated by the trigger (joins-free reports).
4. Trigger attachment list trimmed: drop `notifications`, `service_eligible_products`, `service_bundle_items`, `clinical_order_schedule_changes`, `patient_tags`.

This handover starts from the assumption those changes have shipped.

---

## Scope of this redesign

### Goal

Bring audit logging in line with HIPAA Security Rule § 164.312(b) / HITECH expectations, which the DPA (Philippines) also tracks for sensitive health data:

- Authentication successes **and failures**
- Authorization / privilege changes
- ePHI CRUD (already covered by trigger)
- Data exports and prints
- Admin + config changes
- Access TO or change attempts ON the logs themselves
- Tamper-evidence on the audit log itself
- 10-year retention (DPA-aligned, exceeds HIPAA's 6 years)

### Non-goals

- Real-time SIEM integration — Phase 3.
- ML-based anomaly detection on audit stream — Phase 3.
- External cold-storage archival (S3, ClickHouse) — Phase 3.
- Patient-portal "your data access history" UI — separate product feature.

---

## Worker breakdown

### W-A — App-side write call sites for new actions (PARALLEL × 3–4, after ID redesign lands)

For each new `audit_action` enum value, identify the endpoints/code paths that should emit an audit row, write a thin helper, and attach it.

#### A1 — Authentication audit (`LOGIN_FAILED`, `BREAK_GLASS`)

**Files:** `apps/backend/src/modules/auth/` (`routes.ts`, `service.ts`).

- On every failed `POST /api/auth/login` (bad password, locked account, MFA fail), write `LOGIN_FAILED` with `entity_type = 'users'`, `entity_id = matched user's display_id if any` (or NULL if email unmatched — preserve email in `metadata`).
- Track failed-attempt count against the matched user; existing `failed_login_count` column on `users` stays. Audit log captures every attempt; column captures the streak for lock logic.
- On break-glass PHI access (the `isBreakGlass = true` flag in `phi_access_log`), ALSO write an `audit_logs` row with `action = 'BREAK_GLASS'`. Two writes is intentional — break-glass deserves visibility in both feeds.
- Helper signature: `auditLog(tx, { action, entityType, entityId, metadata })` — see existing usages in `audit/service.ts` if present, otherwise create.

**Verification:** failed login from a wrong password produces an audit row; successful login + logout still produce LOGIN/LOGOUT rows.

#### A2 — Export + Print audit (`EXPORT`, `PRINT`)

**Files:** Wherever the app generates PDF/CSV/printable HTML.

Audit needed at:

- Receipt printing (`apps/backend/src/modules/transactions/` + frontend print modal): on print, frontend POSTs to `/api/audit/print-event` with `entity_type = 'transactions'`, `entity_id = txn.display_id`, `metadata = { documentType: 'receipt' }`.
- Lab result printing (`apps/backend/src/modules/lab_orders/`): same pattern with `documentType: 'lab_result'`.
- Day summary export (`apps/backend/src/modules/day_summary/`): `EXPORT` action with `documentType: 'day_summary_csv'`.
- Patient record export — none today, but the helper must be ready for when patient PDF export ships.
- Any future "Export to CSV" admin endpoints (`admin/users`, `admin/transactions`) — add the audit write at the export-handler.

Two thin endpoints to introduce:

- `POST /api/audit/print-event` — body `{ entity_type, entity_id, document_type }`. Verifies the caller has read access to the entity, then writes `PRINT` audit row.
- `POST /api/audit/export-event` — same shape but `action = 'EXPORT'` + the response body of the originating endpoint must include the row count (`metadata.row_count`).

Or — simpler — write the audit row server-side at the moment the export response is built. No new endpoints. **Preferred.** New endpoints are only needed if you want to capture the user's local print event without a server roundtrip; otherwise inline write.

#### A3 — Privilege + config audit (`PERMISSION_CHANGE`, `CONFIG_CHANGE`)

**Files:** `apps/backend/src/modules/admin/users.ts`, `admin/branches.ts`, `admin/approvals.ts`, anywhere `user_roles` or `user_branches` is mutated, anywhere `tenants.settings` or `feature_flags` is mutated.

- `PERMISSION_CHANGE` on every INSERT/UPDATE/DELETE to `user_roles` / `user_branches`. These tables are already audited by the trigger as CREATE/UPDATE/DELETE — but the semantic action `PERMISSION_CHANGE` makes the security review faster ("show me every permission change in the last 30 days" vs "find every audit row whose entity_type is user_roles/user_branches"). Write the semantic action in addition to the trigger row.
- `CONFIG_CHANGE` on writes to `tenants.settings`, `feature_flags`, retention policy fields. Same dual-write logic.

Semantic actions don't have to be canonical — they're a UX layer on top of the trigger CRUD rows.

#### A4 — Audit log access (`AUDIT_ACCESS`)

**Files:** Wherever a user reads the audit log itself (admin endpoint that returns audit rows).

- HIPAA: "Access to or change attempts on the audit logs themselves" must be tracked.
- Today there's no audit-log read endpoint (just direct DB access). If/when an admin UI surfaces audit rows, the read endpoint writes an `AUDIT_ACCESS` row first.
- Add a row-level RLS policy on `audit_logs` denying UPDATE and DELETE for all roles (already implied by partitioned append-only design, but make it explicit).

Skip A4 until an audit-log read UI is built. List as a TODO.

### W-B — Tamper-evidence hash chain (single worker, after W-A)

**Files:** `apps/backend/drizzle/<next>_audit_chain.sql` (new supplementary migration); `audit_log_changes()` trigger function (edit in `0002_audit_and_redaction.sql`).

Add `chain_hash bytea NOT NULL` column to `audit_logs`. Trigger computes:

```
chain_hash = SHA256(
  COALESCE(prev_chain_hash, ''::bytea) ||
  digest(NEW::text, 'sha256')
)
```

Where `prev_chain_hash` is the hash of the most-recent prior audit row in the **same partition** (lookup by `MAX(timestamp)` is acceptable since timestamp is the partition key + indexed).

A nightly job (`pgcron` or `domain_events` consumer) walks the partition's chain and alerts on mismatch — emitted as a domain event consumed by the observability stack.

**Risks to flag:**

- Triggers chained against `pgcrypto.digest` need `CREATE EXTENSION pgcrypto`.
- `MAX(timestamp)` lookup per insert is O(log n) on the partition's timestamp index. At 10K writes/day per tenant this is negligible; at 1M writes/day reconsider.
- Cross-partition boundaries: the chain restarts each month. Verify the partition transition gracefully (last row of month N gets re-hashed into first row of month N+1, or accept the partition-local chain).

**Verification:** insert + assert hash; manually mutate a row (test mode); rebuild chain; mismatch detected.

### W-C — Retention enforcement (single worker, low priority)

**Files:** `apps/backend/drizzle/0007_retention_procs.sql` (edit).

- Current state: monthly partitions are auto-created by `create_next_audit_partitions(months_ahead)`. No automatic archival/drop.
- Target: a `retain_audit_partitions(retain_years int)` proc that DROPs partitions older than the retention window.
- DPA-aligned retention: **10 years** for health-data-related audit rows. Other audit rows (auth, config, export) could use 6 years (HIPAA minimum) — but the simplest answer is "everything 10 years, partition pruning when old."
- Wire a `pg_cron` schedule that runs the prune monthly with `retain_years => 10`.
- Document the retention decision in `.claude/rules/risks.md` (DPA / compliance section).

### W-D — Async ingestion of non-critical audit events (PHASE 3, low priority)

**Files:** new worker under `apps/backend/src/workers/auditEventForwarder/`.

- For app-side `EXPORT`, `PRINT`, `LOGIN`, business-semantic events: write to `domain_events` first (non-blocking), have an `auditEventForwarder` worker batch-insert into `audit_logs` async.
- CRUD trigger writes stay synchronous (integrity requirement).
- Cuts request-path latency on hot endpoints (login, export).
- Only worth doing once measured latency on the audit insert path becomes a problem. Defer indefinitely.

---

## Implementation order

1. **Wait for ID-redesign waves to land** (enum + trigger trim + bigserial audit_logs.id arrive with them).
2. **Wave A** — app-side call sites for new actions. Three parallel workers (A1, A2, A3). Can run alongside any ongoing feature work as long as ID redesign is shipped.
3. **Wave B** — hash chain. After Wave A so the new write paths are visible to the chain.
4. **Wave C** — retention enforcement.
5. **Wave D** — async ingestion. Only if latency measurements demand it.

Estimated total wall-clock once started: **~6–10 hours** across Waves A–C. Wave D is open-ended.

---

## Out of scope

- SIEM integration / external log forwarding
- Realtime anomaly alerts (ML or rule-based)
- Cold storage / S3 archival
- Patient-portal "data access history" feature
- Customer-facing compliance reports (DPA right-to-access exports for the audit data itself)

---

## References

- [HIPAA Audit Log Requirements 2025 — Kiteworks](https://www.kiteworks.com/hipaa-compliance/hipaa-audit-log-requirements/)
- [HIPAA Audit Trail Complete Compliance Guide — Emitrr](https://emitrr.com/blog/hipaa-audit-trail/)
- [The audit_logs table: An architectural anti-pattern — LogVault](https://www.logvault.app/blog/audit-logs-table-anti-pattern)
- [Database Design for Audit Logging — Red Gate](https://www.red-gate.com/blog/database-design-for-audit-logging/)
- Current `audit_logs` shape: `apps/backend/src/shared/db/schema.ts` (audit_logs table, `auditActionEnum`).
- Current trigger: `apps/backend/drizzle/0002_audit_and_redaction.sql` (`audit_log_changes()` function + table attachment list).
- Partitioning + retention procs: `apps/backend/drizzle/0007_retention_procs.sql`.
- Related table: `phi_access_log` (PHI reads — already write-via-app).
- ID redesign: [`docs/handovers/2026-05-18-id-redesign.md`](archive/2026-05-18-id-redesign.md).
