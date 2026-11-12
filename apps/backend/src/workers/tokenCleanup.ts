/**
 * Token Cleanup Worker
 *
 * Deletes expired rows from `refresh_tokens` and `password_reset_tokens`
 * daily (configurable via TOKEN_CLEANUP_INTERVAL_MS).
 *
 * Why: tokens are short-lived (default ~30 days for refresh, ~1 hour for
 * password-reset). Without cleanup the tables grow unboundedly. This worker
 * removes rows where expires_at < now(), keeping the tables lean.
 *
 * Gates:
 *   WORKERS_ENABLED=true  (shared with all background workers)
 *
 * Env vars:
 *   TOKEN_CLEANUP_INTERVAL_MS  — poll interval in ms (default 86 400 000 = 24h)
 *
 * Per-tenant isolation: iterates all tenants, opens a separate db.transaction
 * per tenant with the RLS tenant GUC set. This satisfies the audit trigger
 * boundary (refresh_tokens and password_reset_tokens have no audit trigger,
 * but tenant GUC is set for correctness and future-safety).
 *
 * Neither refresh_tokens nor password_reset_tokens has a RESTRICTIVE DELETE
 * policy — deletes proceed within a normal tenant-scoped transaction.
 *
 * Errors per tenant are caught and logged; a single tenant failure does not
 * abort cleanup for the remaining tenants.
 */

import { sql } from 'drizzle-orm'
// Cross-Branch PHI RFC Step 5 (reconciled): the RFC proposed a new
// `withWorkerTx` for system/worker paths. That is EXACTLY `withSystemTx`
// (AUTH-2), already adopted here. This worker mutates `refresh_tokens` /
// `user_sessions` / `password_reset_tokens` — none carry a `branch_id`
// column, so the `branch_isolation` RLS policy (incl. its WITH CHECK) never
// applies. `branchId: null` here means tenant-wide read; the Step 7a WITH
// CHECK tightening cannot affect these writes. No migration needed.
import { withPlatformTx, withSystemTx } from '../shared/db/withTenantTx.js'
import { logger } from '../shared/utils/logger.js'

// INFRA-4: a non-numeric/zero env value would yield NaN and make setInterval
// fire on the next tick — a tight loop. Fall back to the default instead.
const _tokenCleanupMs = Number(process.env.TOKEN_CLEANUP_INTERVAL_MS)
const INTERVAL_MS =
  Number.isFinite(_tokenCleanupMs) && _tokenCleanupMs > 0 ? _tokenCleanupMs : 86_400_000

const log = logger.child({ worker: 'tokenCleanup' })

// ─── Per-tenant cleanup ───────────────────────────────────────────────────────

async function cleanupForTenant(
  tenantId: string,
): Promise<{ refreshDeleted: number; resetDeleted: number }> {
  let refreshDeleted = 0
  let resetDeleted = 0

  await withSystemTx({ tenantId, branchId: null }, async (tx) => {
    const refreshResult = await tx.execute<{ count: string }>(sql`
      WITH deleted AS (
        DELETE FROM refresh_tokens
        WHERE tenant_id = ${tenantId}
          AND expires_at < now()
        RETURNING id
      )
      SELECT count(*)::text AS count FROM deleted
    `)
    refreshDeleted = parseInt(refreshResult[0]?.['count'] ?? '0', 10)

    const resetResult = await tx.execute<{ count: string }>(sql`
      WITH deleted AS (
        DELETE FROM password_reset_tokens
        WHERE tenant_id = ${tenantId}
          AND expires_at < now()
        RETURNING id
      )
      SELECT count(*)::text AS count FROM deleted
    `)
    resetDeleted = parseInt(resetResult[0]?.['count'] ?? '0', 10)
  })

  return { refreshDeleted, resetDeleted }
}

// ─── Cleanup cycle ────────────────────────────────────────────────────────────

async function runCleanupCycle(): Promise<void> {
  // tenants table has RLS (M11/0022) — read cross-tenant via platform admin.
  const tenantsResult = await withPlatformTx({ platformUserId: -1 }, async (tx) =>
    tx.execute<{ id: string }>(sql`SELECT id FROM tenants ORDER BY id`),
  )

  let totalRefresh = 0
  let totalReset = 0

  for (const row of tenantsResult) {
    const tenantId = row['id']
    try {
      const { refreshDeleted, resetDeleted } = await cleanupForTenant(tenantId)
      totalRefresh += refreshDeleted
      totalReset += resetDeleted

      if (refreshDeleted > 0 || resetDeleted > 0) {
        log.info(
          { tenantId, refreshDeleted, resetDeleted },
          '[tokenCleanup] deleted expired tokens for tenant',
        )
      }
    } catch (err) {
      log.error({ tenantId, err }, '[tokenCleanup] cleanup error for tenant')
    }
  }

  log.info(
    { totalRefresh, totalReset, tenantsScanned: tenantsResult.length },
    '[tokenCleanup] cleanup cycle complete',
  )
}

// ─── Startup / shutdown ───────────────────────────────────────────────────────

let shuttingDown = false
let loopHandle: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (shuttingDown) return
  loopHandle = setTimeout(async () => {
    try {
      await runCleanupCycle()
    } catch (err) {
      log.error({ err }, '[tokenCleanup] cycle error')
    }
    scheduleNext()
  }, INTERVAL_MS)
}

export function startTokenCleanup(): void {
  if (process.env.WORKERS_ENABLED !== 'true') {
    log.info('[tokenCleanup] worker skipped — WORKERS_ENABLED != true')
    return
  }

  log.info({ intervalMs: INTERVAL_MS }, '[tokenCleanup] worker started')

  // Run immediately on boot, then on interval
  void runCleanupCycle().catch((err) => {
    log.error({ err }, '[tokenCleanup] initial cycle error')
  })

  scheduleNext()
}

export function stopTokenCleanup(): Promise<void> {
  return new Promise((resolve) => {
    shuttingDown = true
    if (loopHandle !== null) {
      clearTimeout(loopHandle)
      loopHandle = null
    }
    log.info('[tokenCleanup] worker stopped')
    resolve()
  })
}
