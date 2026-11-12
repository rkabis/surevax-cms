/**
 * Audit Chain Verification Worker
 *
 * Walks the current and prior month's audit_logs partition via the
 * `verify_audit_chain(partition_name)` SQL function (0011_audit_chain_verifier.sql)
 * and emits a PHI-free Sentry security alert whenever a row's stored chain
 * hash disagrees with the recomputed hash. A clean run is silent at info level.
 *
 * Why: audit_logs is append-only and chained — each row's `chain_hash` includes
 * the prior row's hash. Tampering breaks the chain. The on-demand verifier
 * endpoint (GET /api/admin/audit/verify-chain) lets a human investigate; this
 * worker proactively pages on integrity loss without waiting for an audit.
 *
 * Gates:
 *   WORKERS_ENABLED=true  (shared with all background workers)
 *
 * Env vars:
 *   AUDIT_CHAIN_VERIFY_INTERVAL_MS — poll interval in ms (default 86 400 000 = 24h)
 *
 * No tenant context required — audit_logs is global (not tenant-scoped at the
 * partition level) and the verify_audit_chain function reads via SECURITY DEFINER.
 *
 * Errors are logged but do not crash the process. The next cycle retries.
 */

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { withPlatformTx } from '../shared/db/withTenantTx.js'
import {
  securityAlertSink,
  type SecurityAlert,
  type SecurityAlertSink,
} from '../shared/observability/securityAlert.js'
import { logger } from '../shared/utils/logger.js'

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000

function readIntervalMs(): number {
  const configured = Number.parseInt(
    process.env.AUDIT_CHAIN_VERIFY_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS),
    10,
  )
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MS
}

const INTERVAL_MS = readIntervalMs()

const log = logger.child({ worker: 'verifyAuditChain' })

// ─── Partition naming ─────────────────────────────────────────────────────────

/**
 * Partition naming follows `audit_logs_YYYY_MM` per
 * `0007_audit_partition_maintenance.sql` (see `create_next_audit_partitions`).
 */
export function partitionName(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `audit_logs_${yyyy}_${mm}`
}

export function currentAndPriorPartitions(now: Date): string[] {
  const current = partitionName(now)
  const prior = partitionName(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))
  return [prior, current]
}

// ─── Verification cycle ───────────────────────────────────────────────────────

export type ChainRow = {
  id: string
  ts: string
  match: boolean
}

export type PartitionVerificationResult =
  | Readonly<{ partition: string; status: 'intact' }>
  | Readonly<{
      partition: string
      status: 'tampered'
      mismatchCount: number
      alertDelivered: boolean
      alertEventId?: string
    }>
  | Readonly<{
      partition: string
      status: 'verification_error'
      alertDelivered: boolean
      alertEventId?: string
    }>

type AuditChainLogger = Pick<Logger, 'info' | 'warn' | 'error'>

export interface AuditChainVerificationDependencies {
  verifyRows(partition: string): Promise<readonly ChainRow[]>
  alertSink: SecurityAlertSink
  logger: AuditChainLogger
  now(): Date
}

async function queryMismatches(partition: string): Promise<readonly ChainRow[]> {
  // verify_audit_chain is SECURITY DEFINER (0011_audit_chain_verifier.sql) so
  // the app role can EXECUTE it directly once granted. We still wrap in
  // withPlatformTx so the function call inherits a coherent transaction
  // boundary (matters if the verifier reads from RLS-enforced relations as
  // INVOKER inside the SECURITY DEFINER body in any future revision).
  return withPlatformTx({ platformUserId: -1 }, async (tx) =>
    tx.execute<ChainRow>(
      sql`SELECT id::text AS id, ts::text AS ts, match
          FROM verify_audit_chain(${partition})
          WHERE match = false`,
    ),
  )
}

function safeErrorMetadata(error: unknown): { errorName: string; errorCode?: string } {
  const safeToken = (value: unknown, fallback: string, maxLength: number): string =>
    typeof value === 'string' && new RegExp(`^[A-Za-z0-9_.-]{1,${maxLength}}$`).test(value)
      ? value
      : fallback

  const errorName = safeToken(error instanceof Error ? error.name : undefined, 'UnknownError', 64)
  const candidateCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  const errorCode = safeToken(candidateCode, '', 32)

  return errorCode === '' ? { errorName } : { errorName, errorCode }
}

function safeFirstMismatch(row: ChainRow | undefined): {
  firstMismatchAuditId?: string
  firstMismatchTimestamp?: string
} {
  if (row === undefined) return {}

  const firstMismatchAuditId = /^\d{1,20}$/.test(row.id) ? row.id : undefined
  const timestamp = new Date(row.ts)
  const firstMismatchTimestamp = Number.isNaN(timestamp.getTime())
    ? undefined
    : timestamp.toISOString()

  return { firstMismatchAuditId, firstMismatchTimestamp }
}

export function createAuditChainVerificationService(
  overrides: Partial<AuditChainVerificationDependencies> = {},
): {
  verifyPartition(partition: string): Promise<PartitionVerificationResult>
  runVerifyCycle(): Promise<PartitionVerificationResult[]>
} {
  const dependencies: AuditChainVerificationDependencies = {
    verifyRows: queryMismatches,
    alertSink: securityAlertSink,
    logger: log,
    now: () => new Date(),
    ...overrides,
  }

  async function deliverAlert(
    alert: SecurityAlert,
  ): Promise<{ alertDelivered: boolean; alertEventId?: string }> {
    try {
      const delivered = await dependencies.alertSink.deliver(alert)
      return { alertDelivered: true, alertEventId: delivered.eventId }
    } catch {
      // Do not serialize the delivery exception. SDK/network errors can carry
      // DSNs, proxy credentials, or response content. The alert kind and
      // partition are sufficient for the local fallback signal and retry.
      dependencies.logger.error(
        { alertKind: alert.kind, partition: alert.partition },
        '[verifyAuditChain] security alert delivery failed — next cycle will retry',
      )
      return { alertDelivered: false }
    }
  }

  async function verifyPartition(partition: string): Promise<PartitionVerificationResult> {
    let rows: readonly ChainRow[]
    try {
      rows = await dependencies.verifyRows(partition)
    } catch (error) {
      const errorMetadata = safeErrorMetadata(error)
      const delivery = await deliverAlert({
        kind: 'audit_chain_verification_error',
        partition,
        ...errorMetadata,
      })

      dependencies.logger.error(
        { partition, ...errorMetadata, ...delivery },
        '[verifyAuditChain] partition verification failed',
      )

      return { partition, status: 'verification_error', ...delivery }
    }

    if (rows.length === 0) {
      dependencies.logger.info({ partition }, '[verifyAuditChain] partition chain intact')
      return { partition, status: 'intact' }
    }

    const firstMismatch = safeFirstMismatch(rows[0])
    const delivery = await deliverAlert({
      kind: 'audit_chain_tamper',
      partition,
      mismatchCount: rows.length,
      ...firstMismatch,
    })

    dependencies.logger.error(
      { partition, mismatchCount: rows.length, ...firstMismatch, ...delivery },
      '[verifyAuditChain] audit chain mismatch detected — investigate',
    )

    return {
      partition,
      status: 'tampered',
      mismatchCount: rows.length,
      ...delivery,
    }
  }

  async function runVerifyCycle(): Promise<PartitionVerificationResult[]> {
    const partitions = currentAndPriorPartitions(dependencies.now())
    dependencies.logger.info({ partitions }, '[verifyAuditChain] verifying audit chain partitions')

    const results: PartitionVerificationResult[] = []
    for (const partition of partitions) {
      results.push(await verifyPartition(partition))
    }
    return results
  }

  return { verifyPartition, runVerifyCycle }
}

const defaultVerificationService = createAuditChainVerificationService()

export const runVerifyCycle = defaultVerificationService.runVerifyCycle

// ─── Startup / shutdown ───────────────────────────────────────────────────────

let shuttingDown = false
let loopHandle: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (shuttingDown) return
  loopHandle = setTimeout(async () => {
    try {
      await runVerifyCycle()
    } catch {
      log.error('[verifyAuditChain] verify cycle failed unexpectedly')
    }
    scheduleNext()
  }, INTERVAL_MS)
}

export function startVerifyAuditChain(): void {
  if (process.env.WORKERS_ENABLED !== 'true') {
    log.info('[verifyAuditChain] worker skipped — WORKERS_ENABLED != true')
    return
  }

  shuttingDown = false
  log.info({ intervalMs: INTERVAL_MS }, '[verifyAuditChain] worker started')

  void runVerifyCycle().catch(() => {
    log.error('[verifyAuditChain] initial verify failed unexpectedly')
  })

  scheduleNext()
}

export function stopVerifyAuditChain(): Promise<void> {
  return new Promise((resolve) => {
    shuttingDown = true
    if (loopHandle !== null) {
      clearTimeout(loopHandle)
      loopHandle = null
    }
    log.info('[verifyAuditChain] worker stopped')
    resolve()
  })
}
