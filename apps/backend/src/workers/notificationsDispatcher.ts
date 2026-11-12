/**
 * Notifications Dispatcher Worker
 *
 * Phase-1 stub: polls `notifications` for Queued rows per tenant, logs the
 * dispatch intent via pino, and flips status to Sent. No real SMS/Email/Push
 * is sent — this wires the lifecycle so future PRs can swap in Twilio/SES.
 *
 * Gates:
 *   WORKERS_ENABLED=true  (shared with domainEventsPublisher, analyticsRefresh)
 *
 * Interval: configurable via NOTIFICATION_POLL_MS (default 30 seconds).
 *
 * Per-tenant isolation: each poll tick iterates all active tenants and opens
 * a separate db.transaction per tenant, setting the RLS tenant GUC inside
 * the transaction. This satisfies the audit trigger which raises on missing
 * app.current_tenant_id.
 *
 * Optimistic concurrency: UPDATEs are WHERE row_version = $current so
 * concurrent processes can't double-send. 0 rows updated = someone else
 * processed it first; skip silently.
 *
 * Errors are caught per-row: retry_count is incremented, failure_reason set.
 * Once retry_count >= 5 the row flips to Failed.
 *
 * Exported helper: triggerNotification — callers (service modules) use this
 * to enqueue a Queued notification in their own db.transaction. Returns the
 * newly-inserted notifications.id (bigint — internal).
 */

import { sql } from 'drizzle-orm'
// Cross-Branch PHI RFC Step 5 (reconciled): the RFC's proposed `withWorkerTx`
// IS `withSystemTx` (AUTH-2), already in use here. This worker reads + WRITES
// `notifications` (status updates), which has no `branch_id` column —
// `branch_isolation` (incl. the Step 7a WITH CHECK tightening) never applies,
// so the cross-branch write-rejection risk does NOT touch this path.
// `branchId: null` is the tenant-wide read scope. No migration needed.
import { withPlatformTx, withSystemTx, type Tx } from '../shared/db/withTenantTx.js'
import { logger } from '../shared/utils/logger.js'
import { defaultSender } from '../modules/notifications/sender.js'

// INFRA-4: guard NaN/zero → tight loop; fall back to the 30s default.
const _notifPollMs = Number(process.env.NOTIFICATION_POLL_MS)
const POLL_INTERVAL_MS = Number.isFinite(_notifPollMs) && _notifPollMs > 0 ? _notifPollMs : 30_000
const BATCH_SIZE = 50
const MAX_RETRIES = 5

// ─── triggerNotification helper ──────────────────────────────────────────────

/**
 * Enqueue a Queued notification inside a caller-provided transaction.
 *
 * The caller's transaction must already have the tenant GUC set via
 *   `await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`)
 * because the audit trigger requires it.
 *
 * patientId / userId / createdById / templateId are internal bigint FKs.
 * Returns the newly-inserted notifications.id (bigint).
 */
export async function triggerNotification(
  tx: Tx,
  opts: {
    tenantId: string
    patientId: number
    userId?: number | null
    channel: 'SMS' | 'Email' | 'Push'
    templateId?: number | null
    recipientAddress?: string | null
    subject?: string | null
    body: string
    scheduledAt?: Date | null
    metadata?: Record<string, unknown> | null
    createdById?: number | null
  },
): Promise<number> {
  const rows = await tx.execute<{ id: string }>(sql`
    INSERT INTO notifications (
      tenant_id, template_id, patient_id, user_id,
      channel, recipient_address, subject, body,
      status, scheduled_at,
      metadata,
      created_by_id,
      created_at, updated_at
    ) VALUES (
      ${opts.tenantId},
      ${opts.templateId ?? null},
      ${opts.patientId},
      ${opts.userId ?? null},
      ${opts.channel},
      ${opts.recipientAddress ?? null},
      ${opts.subject ?? null},
      ${opts.body},
      'Queued',
      ${opts.scheduledAt ?? null},
      ${opts.metadata ? JSON.stringify(opts.metadata) : null}::jsonb,
      ${opts.createdById ?? null},
      now(), now()
    )
    RETURNING id
  `)

  return Number(rows[0]?.id ?? 0)
}

// ─── Dispatch tick ───────────────────────────────────────────────────────────

async function dispatchForTenant(tenantId: string): Promise<void> {
  // WORK-4 fix: the original code wrapped the entire tenant batch in one
  // db.transaction. Any single row that threw a Postgres error aborted the
  // whole transaction, rolling back all sibling rows' status updates.
  //
  // Fix: fetch candidate IDs outside any per-row tx (cheap scan), then
  // process each row in its own independent withSystemTx. A failure on
  // row N rolls back only row N; rows N+1..M continue normally.
  const candidates = await withSystemTx({ tenantId, branchId: null }, async (tx) =>
    tx.execute<{
      id: string | number
      row_version: number
      retry_count: number
    }>(sql`
      SELECT id, row_version, retry_count
      FROM notifications
      WHERE tenant_id = ${tenantId}
        AND status = 'Queued'
        AND (scheduled_at IS NULL OR scheduled_at <= now())
        AND retry_count < ${MAX_RETRIES}
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
    `),
  )

  for (const candidate of candidates) {
    try {
      // Per-row transaction — isolated from siblings (WORK-4).
      await withSystemTx({ tenantId, branchId: null }, async (tx) => {
        // Re-fetch with row_version check inside the tx so we have current
        // channel/body and guard against concurrent updates.
        const rows = await tx.execute<Record<string, unknown>>(sql`
          SELECT
            id,
            tenant_id         AS "tenantId",
            channel,
            template_id       AS "templateId",
            recipient_address AS "recipientAddress",
            subject,
            body,
            row_version       AS "rowVersion",
            retry_count       AS "retryCount"
          FROM notifications
          WHERE id          = ${candidate.id}
            AND row_version = ${candidate.row_version}
            AND status      = 'Queued'
          LIMIT 1
        `)

        if (rows.length === 0) {
          // Row was claimed / updated by a concurrent worker between scan and this tx.
          logger.debug(
            { worker: 'notificationsDispatcher', notificationId: candidate.id },
            '[notifications] skipped — optimistic lock miss on re-fetch',
          )
          return
        }

        const row = {
          id: rows[0]!['id'] as string | number,
          tenantId: rows[0]!['tenantId'] as string,
          channel: rows[0]!['channel'] as string,
          templateId: rows[0]!['templateId'] as number | null,
          recipientAddress: rows[0]!['recipientAddress'] as string | null,
          subject: rows[0]!['subject'] as string | null,
          body: rows[0]!['body'] as string,
          rowVersion: rows[0]!['rowVersion'] as number,
          retryCount: rows[0]!['retryCount'] as number,
        }

        logger.info(
          {
            worker: 'notificationsDispatcher',
            notificationId: row.id,
            channel: row.channel,
            templateId: row.templateId,
            tenantId: row.tenantId,
          },
          '[notifications] dispatching notification',
        )

        // NOTIF-3 fix: call the pluggable sender before marking Sent.
        // The sender runs INSIDE the per-row transaction so that a send
        // failure prevents the status update from committing.
        const sendResult = await defaultSender.send(
          row.channel,
          row.recipientAddress ?? '',
          row.body,
          row.subject,
          { notificationId: String(row.id), tenantId: row.tenantId },
        )

        if (!sendResult.success) {
          // Sender returned a failure — throw so the catch block records it.
          throw new Error(sendResult.error ?? 'Sender returned failure without message')
        }

        // Optimistic-lock UPDATE — if row_version changed, 0 rows updated → skip.
        // Mark Sent only after sender resolved successfully.
        const updateResult = await tx.execute<Record<string, unknown>>(sql`
          UPDATE notifications
          SET
            status               = 'Sent',
            sent_at              = now(),
            external_message_id  = ${sendResult.externalMessageId ?? null},
            updated_at           = now(),
            row_version          = row_version + 1
          WHERE id          = ${row.id}
            AND row_version = ${row.rowVersion}
            AND status      = 'Queued'
          RETURNING id
        `)

        if (!updateResult[0]) {
          logger.debug(
            { worker: 'notificationsDispatcher', notificationId: row.id },
            '[notifications] skipped — optimistic lock miss on update',
          )
        }
      })
    } catch (err) {
      // Per-row error: record failure in a fresh tx so it is persisted even
      // though the processing tx was rolled back (WORK-4).
      const errorMessage = err instanceof Error ? err.message : String(err)
      const nextRetry = (candidate.retry_count ?? 0) + 1
      const nextStatus = nextRetry >= MAX_RETRIES ? 'Failed' : 'Queued'

      logger.warn(
        { worker: 'notificationsDispatcher', notificationId: candidate.id, err, nextRetry },
        '[notifications] dispatch error — incrementing retry_count',
      )

      try {
        await withSystemTx({ tenantId, branchId: null }, async (tx) => {
          await tx.execute(sql`
            UPDATE notifications
            SET
              retry_count    = ${nextRetry},
              failure_reason = ${errorMessage.slice(0, 500)},
              status         = ${nextStatus},
              updated_at     = now(),
              row_version    = row_version + 1
            WHERE id = ${candidate.id}
          `)
        })
      } catch (updateErr) {
        logger.error(
          { worker: 'notificationsDispatcher', notificationId: candidate.id, updateErr },
          '[notifications] failed to update retry_count',
        )
      }
    }
  }
}

async function runDispatchCycle(): Promise<void> {
  // tenants table has RLS (M11/0022) — read cross-tenant via platform admin.
  const tenantsResult = await withPlatformTx({ platformUserId: -1 }, async (tx) =>
    tx.execute<Record<string, unknown>>(sql`SELECT id FROM tenants ORDER BY id`),
  )

  for (const raw of tenantsResult) {
    const tenantId = raw['id'] as string
    try {
      await dispatchForTenant(tenantId)
    } catch (err) {
      logger.error(
        { worker: 'notificationsDispatcher', tenantId, err },
        '[notifications] dispatch cycle error for tenant',
      )
    }
  }
}

// ─── Startup / shutdown ──────────────────────────────────────────────────────

let shuttingDown = false
let loopHandle: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (shuttingDown) return
  loopHandle = setTimeout(async () => {
    try {
      await runDispatchCycle()
    } catch (err) {
      logger.error({ worker: 'notificationsDispatcher', err }, '[notifications] cycle error')
    }
    scheduleNext()
  }, POLL_INTERVAL_MS)
}

export function startNotificationsDispatcher(): void {
  if (process.env.WORKERS_ENABLED !== 'true') {
    logger.info(
      { worker: 'notificationsDispatcher' },
      '[notifications] worker skipped — WORKERS_ENABLED != true',
    )
    return
  }

  logger.info(
    { worker: 'notificationsDispatcher', intervalMs: POLL_INTERVAL_MS },
    '[notifications] dispatcher worker started',
  )
  scheduleNext()
}

export function stopNotificationsDispatcher(): Promise<void> {
  return new Promise((resolve) => {
    shuttingDown = true
    if (loopHandle !== null) {
      clearTimeout(loopHandle)
      loopHandle = null
    }
    logger.info({ worker: 'notificationsDispatcher' }, '[notifications] dispatcher worker stopped')
    resolve()
  })
}
