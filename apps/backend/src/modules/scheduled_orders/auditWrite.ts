import { auditLog } from '../../shared/utils/auditLog.js'
import type { Tx } from '../../shared/db/withTenantTx.js'

/**
 * Explicit audit-log insert for schedule-change events.
 *
 * The audit trigger fires automatically on UPDATE rows, but two cases need an
 * explicit insert:
 *  1. /recompute may be a no-op if dates already correct (trigger won't fire).
 *  2. /reschedule needs to capture the human `reason` string in `changes` jsonb.
 *
 * Thin wrapper over the shared `auditLog` helper that preserves the legacy
 * `recordId → entityId` parameter rename + the SCHEDULE_CHANGE / TRANSACTION_MODIFY
 * action defaulting that callers in this module rely on.
 */
export async function writeScheduleChangeAudit(
  tx: Tx,
  args: {
    tenantId: string
    /** users.id (bigint). */
    userId: number
    /** clinical_orders.display_id (text). */
    recordId: string
    action?: 'SCHEDULE_CHANGE' | 'TRANSACTION_MODIFY'
    changes: Record<string, unknown>
  },
): Promise<void> {
  await auditLog(tx, {
    tenantId: args.tenantId,
    userId: args.userId,
    action: args.action ?? 'SCHEDULE_CHANGE',
    entityType: 'clinical_orders',
    entityId: args.recordId,
    changes: args.changes,
  })
}
