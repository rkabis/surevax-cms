/**
 * Shared audit-log helper.
 *
 * Inserts an `audit_logs` row from app code. The audit trigger
 * (`audit_log_changes()` in `0002_audit_and_redaction.sql`) handles
 * row-level CRUD audit automatically; this helper covers the
 * *semantic* events that the trigger can't see:
 *
 *  - `LOGIN`, `LOGOUT`, `LOGIN_FAILED`
 *  - `BREAK_GLASS` PHI access
 *  - `EXPORT` / `PRINT` of patient-derived documents
 *  - `PERMISSION_CHANGE` (user_roles / user_branches mutations — emitted
 *     in addition to the trigger's CRUD row to make security reviews
 *     "show me every permission change" trivial)
 *  - `CONFIG_CHANGE` (tenants.settings / feature_flags mutations)
 *  - `AUDIT_ACCESS` (reads of `audit_logs` itself — when an admin UI lands)
 *  - `SCHEDULE_CHANGE` / `TRANSACTION_MODIFY` (already used by
 *    `scheduled_orders/auditWrite.ts`; left as-is for compat)
 *
 * Two-tier IDs (2026-05-19 redesign):
 *   - `audit_logs.id` is bigserial — let Postgres allocate; never pass `id`.
 *   - `audit_logs.entity_id` is text — stores the audited row's display_id
 *     (e.g. `'PAT_K9MX3VQ2'`). The trigger denormalizes `entity_display_id`
 *     into the same value when the row exists; this helper sets both to
 *     the supplied display_id since the row may not exist at emit time
 *     (e.g. failed login against an unmatched email).
 *
 * Audit trigger requirement: `app.current_tenant_id` GUC must be set before
 * the insert. Callers MUST be inside `withTenantTx(...)`. The `tx` overload
 * leverages an existing transaction; the standalone overload opens its own.
 */

import { auditLogs } from '../db/schema.js'
import { withSystemTx, withTenantTx, type Tx } from '../db/withTenantTx.js'

/**
 * Audit-log action — mirrors `audit_action` enum in `schema.ts`. Kept here
 * as a string-literal union so calls fail at compile time when a new value
 * is used before being added to the enum.
 */
export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'BREAK_GLASS'
  | 'TRANSACTION_MODIFY'
  | 'SCHEDULE_CHANGE'
  | 'CROSS_BRANCH_ACCESS'
  | 'PERMISSION_CHANGE'
  | 'CONFIG_CHANGE'
  | 'EXPORT'
  | 'PRINT'
  | 'AUDIT_ACCESS'

export type AuditLogArgs = {
  tenantId: string
  /** users.id (bigint) or null for unauthenticated / unmatched events. */
  userId: number | null
  /** branches.id (bigint) or null for tenant-wide events. */
  branchId?: number | null
  action: AuditAction
  /** Audited table name (e.g. `'users'`, `'transactions'`). */
  entityType: string
  /** Audited row's display_id, or null when no specific row applies. */
  entityId: string | null
  /** Structured payload to redact-and-store under `changes` jsonb. */
  changes?: Record<string, unknown>
  /** Structured payload to store under `metadata` jsonb (no redaction). */
  metadata?: Record<string, unknown>
  /** Optional IP + UA from the request — surfaced for security review. */
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Insert one audit_logs row inside an existing transaction.
 *
 * `app.current_tenant_id` must already be set on the transaction — the
 * audit trigger raises otherwise. The standard pattern is to call this
 * from inside `withTenantTx(...)`.
 */
export async function auditLog(tx: Tx, args: AuditLogArgs): Promise<void> {
  await tx.insert(auditLogs).values({
    // id: bigserial — let Postgres allocate.
    tenantId: args.tenantId,
    userId: args.userId,
    branchId: args.branchId ?? null,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    changes: args.changes !== undefined ? (JSON.stringify(args.changes) as unknown) : null,
    metadata: args.metadata !== undefined ? (JSON.stringify(args.metadata) as unknown) : null,
  })
}

/**
 * Standalone form — opens its own transaction and inserts a single row.
 *
 * Use when the caller doesn't already have a transaction in scope (e.g.
 * fire-and-forget logging from a route handler that has already committed).
 * Prefer the `tx` form when you can; both calls together would double up
 * the GUC bootstrap.
 *
 * AUTH-5 fix: when userId is null (unauthenticated / unmatched-email events),
 * the GUC `app.current_user_id` must be set to an empty string so the audit
 * trigger resolves it as NULL via NULLIF(...,'') — not '0' (phantom bigint FK).
 * We open the transaction directly instead of routing through withTenantTx
 * (which types userId as non-nullable number) when userId is null.
 */
export async function auditLogStandalone(args: AuditLogArgs): Promise<void> {
  if (args.userId !== null) {
    // Happy path: known user — delegate to withTenantTx which handles all GUCs.
    await withTenantTx(
      { tenantId: args.tenantId, userId: args.userId, branchId: args.branchId ?? null },
      async (tx) => {
        await auditLog(tx, args)
      },
    )
    return
  }

  // AUTH-5: userId is null (e.g. failed login for unmatched email).
  // withSystemTx sets app.current_user_id = '' so the trigger NULLIFs it to
  // NULL instead of casting '0' → bigint 0. Also flips app.is_system = 'true'
  // so future policies can distinguish system-origin audit rows from user ones.
  await withSystemTx({ tenantId: args.tenantId, branchId: args.branchId ?? null }, async (tx) => {
    await auditLog(tx, args)
  })
}
