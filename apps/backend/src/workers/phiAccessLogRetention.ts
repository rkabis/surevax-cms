/**
 * PHI Access Log Retention Worker
 *
 * Deletes phi_access_log rows older than PHI_ACCESS_LOG_RETENTION_DAYS (default 365)
 * from each tenant on a weekly schedule (configurable via
 * PHI_ACCESS_LOG_RETENTION_INTERVAL_MS).
 *
 * Why: phi_access_log is a HIPAA-mandated access audit trail. The Philippines
 * Data Privacy Act requires retention of access logs for a reasonable period;
 * 365 days is the configurable default. Older rows are pruned to control table
 * growth.
 *
 * Gates:
 *   WORKERS_ENABLED=true  (shared with all background workers)
 *
 * Env vars:
 *   PHI_ACCESS_LOG_RETENTION_INTERVAL_MS — poll interval in ms (default 604 800 000 = 7d)
 *   PHI_ACCESS_LOG_RETENTION_DAYS        — rows older than this are deleted (default 365)
 *
 * RLS bypass: phi_access_log has a RESTRICTIVE RLS policy blocking all DELETEs
 * at the app connection level (phi_access_log_no_delete in 0004_phase1_rls_triggers.sql).
 * This worker calls the `purge_phi_access_log` SECURITY DEFINER procedure
 * (defined in 0027_retention_jobs.sql) which runs as the DB owner and bypasses
 * RLS, while still filtering strictly by tenant_id.
 *
 * phi_access_log is excluded from the audit trigger — no audit-log flood.
 *
 * Errors per tenant are caught and logged; a single tenant failure does not
 * abort cleanup for the remaining tenants.
 */

import { sql } from 'drizzle-orm'
// Cross-Branch PHI RFC Step 5 (reconciled): the RFC's proposed `withWorkerTx`
// IS `withSystemTx` (AUTH-2), already in use here. This worker deletes from
// `phi_access_log`, which has no `branch_id` column — `branch_isolation`
// (incl. its Step 7a WITH CHECK tightening) never applies. `branchId: null`
// is the tenant-wide read scope. No migration needed.
import { withPlatformTx, withSystemTx } from '../shared/db/withTenantTx.js'
import { logger } from '../shared/utils/logger.js'

const INTERVAL_MS = parseInt(
  process.env.PHI_ACCESS_LOG_RETENTION_INTERVAL_MS ?? String(7 * 24 * 60 * 60 * 1_000),
  10,
)
const RETENTION_DAYS = parseInt(process.env.PHI_ACCESS_LOG_RETENTION_DAYS ?? '365', 10)

const log = logger.child({ worker: 'phiAccessLogRetention' })

// ─── Per-tenant retention ─────────────────────────────────────────────────────

async function retainForTenant(tenantId: string): Promise<number> {
  // CALL the SECURITY DEFINER procedure — it bypasses the RESTRICTIVE DELETE policy.
  // The OUT parameter p_deleted is returned as a result set row.
  const result = await withSystemTx({ tenantId, branchId: null }, async (tx) =>
    tx.execute<{ p_deleted: string }>(sql`
      CALL purge_phi_access_log(${tenantId}, ${RETENTION_DAYS}, 0::bigint)
    `),
  )

  // postgres.js returns CALL results as a row with the INOUT parameter value.
  const deleted = parseInt(result[0]?.['p_deleted'] ?? '0', 10)
  return deleted
}

// ─── Retention cycle ──────────────────────────────────────────────────────────

async function runRetentionCycle(): Promise<void> {
  // tenants table has RLS (M11/0022) — read cross-tenant via platform admin.
  const tenantsResult = await withPlatformTx({ platformUserId: -1 }, async (tx) =>
    tx.execute<{ id: string }>(sql`SELECT id FROM tenants ORDER BY id`),
  )

  let totalDeleted = 0

  for (const row of tenantsResult) {
    const tenantId = row['id']
    try {
      const deleted = await retainForTenant(tenantId)
      totalDeleted += deleted

      if (deleted > 0) {
        log.info(
          { tenantId, deleted, retentionDays: RETENTION_DAYS },
          '[phiAccessLogRetention] deleted old PHI access log rows for tenant',
        )
      }
    } catch (err) {
      log.error({ tenantId, err }, '[phiAccessLogRetention] retention error for tenant')
    }
  }

  log.info(
    { totalDeleted, retentionDays: RETENTION_DAYS, tenantsScanned: tenantsResult.length },
    '[phiAccessLogRetention] retention cycle complete',
  )
}

// ─── Startup / shutdown ───────────────────────────────────────────────────────

let shuttingDown = false
let loopHandle: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (shuttingDown) return
  loopHandle = setTimeout(async () => {
    try {
      await runRetentionCycle()
    } catch (err) {
      log.error({ err }, '[phiAccessLogRetention] cycle error')
    }
    scheduleNext()
  }, INTERVAL_MS)
}

export function startPhiAccessLogRetention(): void {
  if (process.env.WORKERS_ENABLED !== 'true') {
    log.info('[phiAccessLogRetention] worker skipped — WORKERS_ENABLED != true')
    return
  }

  log.info(
    { intervalMs: INTERVAL_MS, retentionDays: RETENTION_DAYS },
    '[phiAccessLogRetention] worker started',
  )

  // Run immediately on boot, then on interval
  void runRetentionCycle().catch((err) => {
    log.error({ err }, '[phiAccessLogRetention] initial cycle error')
  })

  scheduleNext()
}

export function stopPhiAccessLogRetention(): Promise<void> {
  return new Promise((resolve) => {
    shuttingDown = true
    if (loopHandle !== null) {
      clearTimeout(loopHandle)
      loopHandle = null
    }
    log.info('[phiAccessLogRetention] worker stopped')
    resolve()
  })
}
