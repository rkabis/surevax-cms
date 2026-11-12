/**
 * Audit Partition Rotation Worker
 *
 * Calls `create_next_audit_partitions(12)` monthly to ensure audit_logs always
 * has at least 12 months of future partitions. The procedure is defined in
 * 0007_audit_partition_maintenance.sql and uses CREATE TABLE IF NOT EXISTS —
 * it is fully idempotent.
 *
 * Why: audit_logs is a range-partitioned table (one partition per calendar month).
 * If no future partition exists when a row is inserted, Postgres raises an error
 * and the audit write fails. This worker keeps a 12-month runway so the app
 * never hits an unpartitioned-write error.
 *
 * Gates:
 *   WORKERS_ENABLED=true  (shared with all background workers)
 *
 * Env vars:
 *   AUDIT_PARTITION_ROTATE_INTERVAL_MS — poll interval in ms (default 2 592 000 000 = 30d)
 *
 * No tenant context is needed — partition creation is DDL, not DML, and
 * audit_logs is not tenant-scoped at the partition level.
 *
 * Errors are logged but do not crash the process. A rotation failure is not
 * immediately fatal (existing partitions still work); the next cycle will retry.
 */

import { sql } from 'drizzle-orm'
import { withPlatformTx } from '../shared/db/withTenantTx.js'
import { logger } from '../shared/utils/logger.js'

// INFRA-4: guard NaN/zero → tight loop; fall back to the 30d default.
const _auditRotateMs = Number(process.env.AUDIT_PARTITION_ROTATE_INTERVAL_MS)
const INTERVAL_MS =
  Number.isFinite(_auditRotateMs) && _auditRotateMs > 0 ? _auditRotateMs : 30 * 24 * 60 * 60 * 1_000

const MONTHS_AHEAD = 12

const log = logger.child({ worker: 'auditPartitionRotate' })

// ─── Rotation cycle ───────────────────────────────────────────────────────────

// M13: retain_audit_partitions(N) drops audit_logs partitions older than N
// years. Defined in 0010_audit_retention.sql alongside create_next_audit_partitions.
// The retention SQL had no Node-side runner — the cron schedule in
// 0010_audit_retention.sql assumes pg_cron, which Railway PG does not provide.
// Pair the call with create_next so partition runway + retention drift in lockstep.
const RETAIN_YEARS = parseInt(process.env.AUDIT_RETENTION_YEARS ?? '10', 10)

async function runRotationCycle(): Promise<void> {
  log.info(
    { monthsAhead: MONTHS_AHEAD },
    '[auditPartitionRotate] calling create_next_audit_partitions',
  )

  // create_next_audit_partitions is SECURITY DEFINER (0007_retention_procs.sql)
  // so the demoted app role can CALL it; the proc itself runs with the owner's
  // privileges to perform the CREATE TABLE.
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    await tx.execute(sql`CALL create_next_audit_partitions(${MONTHS_AHEAD})`)
  })

  log.info(
    { monthsAhead: MONTHS_AHEAD },
    '[auditPartitionRotate] partition rotation complete — runway extended',
  )

  // M13: also drop expired partitions. RETAIN_YEARS defaults to 10 (PH
  // medical-records retention). The procedure is idempotent — no-op if no
  // partition is older than the cutoff.
  log.info({ retainYears: RETAIN_YEARS }, '[auditPartitionRotate] calling retain_audit_partitions')
  // retain_audit_partitions is SECURITY DEFINER (0010_audit_retention.sql),
  // matching create_next_audit_partitions above.
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    await tx.execute(sql`CALL retain_audit_partitions(${RETAIN_YEARS})`)
  })
  log.info({ retainYears: RETAIN_YEARS }, '[auditPartitionRotate] retention sweep complete')
}

// ─── Startup / shutdown ───────────────────────────────────────────────────────

let shuttingDown = false
let loopHandle: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (shuttingDown) return
  loopHandle = setTimeout(async () => {
    try {
      await runRotationCycle()
    } catch (err) {
      log.error({ err }, '[auditPartitionRotate] rotation cycle error')
    }
    scheduleNext()
  }, INTERVAL_MS)
}

export function startAuditPartitionRotate(): void {
  if (process.env.WORKERS_ENABLED !== 'true') {
    log.info('[auditPartitionRotate] worker skipped — WORKERS_ENABLED != true')
    return
  }

  log.info({ intervalMs: INTERVAL_MS }, '[auditPartitionRotate] worker started')

  // Run immediately on boot to ensure partitions exist, then on interval
  void runRotationCycle().catch((err) => {
    log.error({ err }, '[auditPartitionRotate] initial rotation error')
  })

  scheduleNext()
}

export function stopAuditPartitionRotate(): Promise<void> {
  return new Promise((resolve) => {
    shuttingDown = true
    if (loopHandle !== null) {
      clearTimeout(loopHandle)
      loopHandle = null
    }
    log.info('[auditPartitionRotate] worker stopped')
    resolve()
  })
}
