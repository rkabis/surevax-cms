/**
 * Domain Events Publisher Worker
 *
 * Polls `domain_events` for unpublished rows and dispatches them to consumers.
 * Phase 5 ships a single noop dispatcher that logs via pino; real consumers
 * (analytics upsert, notifications, webhooks) are added in subsequent PRs.
 *
 * Gate: only starts when `WORKERS_ENABLED=true`.
 *
 * Locking strategy (WORK-2 fix):
 *   Each row is processed inside the SAME transaction that holds the
 *   FOR UPDATE SKIP LOCKED row-lock. The poll phase fetches candidate IDs
 *   cheaply (no lock), then each row's process phase re-acquires the lock
 *   inside its own per-row transaction: SELECT … WHERE id=$id FOR UPDATE
 *   SKIP LOCKED → if 0 rows returned, a concurrent worker already claimed it
 *   (skip). This eliminates the window between lock release and processing
 *   that caused double-processing.
 *
 * Backoff strategy (WORK-3 fix):
 *   Rows not yet due for retry are filtered OUT in the candidate-fetch SQL
 *   (using occurred_at + exponential backoff window). Old failing events are
 *   therefore never loaded into the poll batch if they are still in their
 *   backoff window — preventing head-of-line stall that was starving newer
 *   eligible events.
 *
 * Graceful shutdown: SIGTERM/SIGINT sets a flag; the loop drains the
 * in-flight batch then exits.
 */

import { and, isNull, lt, sql } from 'drizzle-orm'
// Cross-Branch PHI RFC Step 5 (reconciled): the RFC's proposed `withWorkerTx`
// IS `withSystemTx` (AUTH-2), already in use here. This worker reads + WRITES
// `domain_events` (publish bookkeeping), which has no `branch_id` column —
// `branch_isolation` (incl. the Step 7a WITH CHECK tightening) never applies,
// so the cross-branch write-rejection risk does NOT touch this path.
// `branchId: null` is the tenant-wide read scope. No migration needed.
import { withPlatformTx, withSystemTx, type Tx } from '../shared/db/withTenantTx.js'
import { domainEvents } from '../shared/db/schema.js'
import { logger } from '../shared/utils/logger.js'

// INFRA-4: guard NaN/zero → tight loop; fall back to the 5s default.
const _workerPollMs = Number(process.env.WORKER_POLL_INTERVAL_MS)
const POLL_INTERVAL_MS = Number.isFinite(_workerPollMs) && _workerPollMs > 0 ? _workerPollMs : 5000
const BATCH_SIZE = 100
const MAX_ATTEMPTS = 20
// Use a fixed max backoff of 1 hour (3_600_000 ms)
const MAX_BACKOFF_MS = 3_600_000

/**
 * WORK-3 fix: used only for the in-tx backoff re-check (defence-in-depth).
 * The primary eligibility filter is done in the candidate-fetch SQL, anchored
 * on occurred_at + exponential window, so old failing events are not even
 * fetched in the first place.
 */
function nextRetryAfter(occurredAt: Date, attempts: number): Date {
  if (attempts === 0) return new Date(0) // always eligible on first try
  // exponential backoff capped at MAX_BACKOFF_MS
  const backoffMs = Math.min(Math.pow(2, attempts) * 1000, MAX_BACKOFF_MS)
  return new Date(occurredAt.getTime() + backoffMs)
}

// ─── Dispatchers ────────────────────────────────────────────────────────────

export type DomainEventRow = typeof domainEvents.$inferSelect

/**
 * Log the event for observability.
 */
function logDispatch(row: DomainEventRow): void {
  logger.info(
    {
      worker: 'domainEventsPublisher',
      eventId: row.id,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      tenantId: row.tenantId,
      occurredAt: row.occurredAt,
    },
    '[domain_events] dispatching',
  )
}

/**
 * Route an event to all registered consumers. Each consumer runs inside the
 * caller-provided transaction (already tenant-scoped). A consumer failure
 * rolls back the entire per-row tx and the row will be retried with backoff.
 */
async function dispatch(row: DomainEventRow, tx: Tx): Promise<void> {
  logDispatch(row)

  const { analyticsConsumer } = await import('./domainEventConsumers/analyticsConsumer.js')
  const { notificationConsumer } = await import('./domainEventConsumers/notificationConsumer.js')

  await analyticsConsumer(row, tx)
  await notificationConsumer(row, tx)
}

// ─── Core poll loop ──────────────────────────────────────────────────────────

let shuttingDown = false

async function pollOnce(): Promise<void> {
  const now = new Date()

  // WORK-2 + WORK-3 fix:
  //
  // Previously: one outer tx fetched rows with FOR UPDATE SKIP LOCKED, then
  // the tx committed (releasing the lock), and each row was processed in a
  // SEPARATE tx — leaving a window where concurrent workers could double-process.
  //
  // Fixed strategy:
  //   Step 1: Candidate scan (no lock, cheap) — fetch IDs of rows that are
  //     due for retry. The backoff window is evaluated IN SQL (WORK-3): rows
  //     whose occurred_at + exponential-backoff > now() are excluded from the
  //     batch entirely, preventing old failing events from starving newer ones.
  //   Step 2: Per-row process tx — for each candidate, open one tx that:
  //     (a) re-selects the row WITH FOR UPDATE SKIP LOCKED to claim the lock,
  //     (b) if 0 rows returned, a concurrent worker claimed it — skip safely,
  //     (c) dispatch + mark published_at — ALL within the SAME tx that holds
  //         the row-lock (WORK-2: no gap between lock and processing).

  // Step 1: cheap candidate scan — no row-level lock held. Cross-tenant
  // sweep, so use withPlatformTx (RLS bypass) to see candidate events from
  // every tenant. The per-row processing below switches to per-tenant
  // withSystemTx so writes are tenant-coherent and the audit trigger
  // strict-mode tenant_id match is honored.
  const candidates = await withPlatformTx({ platformUserId: -1 }, async (tx) =>
    tx.execute<{ id: number; tenant_id: string }>(sql`
      SELECT id, tenant_id
      FROM   domain_events
      WHERE  published_at IS NULL
        AND  publish_attempts < ${MAX_ATTEMPTS}
        AND  (
               publish_attempts = 0
            OR occurred_at + (LEAST(POWER(2, publish_attempts)::bigint * 1000, ${MAX_BACKOFF_MS})
                 || ' milliseconds')::interval <= ${now.toISOString()}::timestamptz
             )
      ORDER BY occurred_at
      LIMIT ${BATCH_SIZE}
    `),
  )

  if (candidates.length === 0) return

  logger.debug(
    { worker: 'domainEventsPublisher', count: candidates.length },
    '[domain_events] poll batch',
  )

  for (const candidate of candidates) {
    if (shuttingDown) break

    try {
      // Step 2: per-row tx — lock + process + mark in one atomic operation (WORK-2).
      await withSystemTx({ tenantId: candidate.tenant_id, branchId: null }, async (tx) => {
        // Re-select the row with FOR UPDATE SKIP LOCKED to claim the lock.
        // If SKIP LOCKED returns 0 rows, a concurrent worker already claimed it.
        const locked = await tx
          .select()
          .from(domainEvents)
          .where(
            and(
              sql`${domainEvents.id} = ${candidate.id}`,
              isNull(domainEvents.publishedAt),
              lt(domainEvents.publishAttempts, MAX_ATTEMPTS),
            ),
          )
          .for('update', { skipLocked: true })
          .limit(1)

        if (locked.length === 0) {
          logger.debug(
            { worker: 'domainEventsPublisher', eventId: candidate.id },
            '[domain_events] skipped — claimed by concurrent worker',
          )
          return
        }

        const row = locked[0]!

        // Defence-in-depth backoff re-check (clock skew guard).
        const retryAfter = nextRetryAfter(row.occurredAt, row.publishAttempts)
        if (now < retryAfter) {
          logger.debug(
            {
              worker: 'domainEventsPublisher',
              eventId: row.id,
              nextRetryAfter: retryAfter,
              attempts: row.publishAttempts,
            },
            '[domain_events] skipping — in backoff window',
          )
          return
        }

        // Process inside the same tx that holds the lock (WORK-2: no gap).
        await dispatch(row, tx)

        await tx
          .update(domainEvents)
          .set({ publishedAt: new Date() })
          .where(sql`${domainEvents.id} = ${row.id}`)
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)

      logger.warn(
        {
          worker: 'domainEventsPublisher',
          eventId: candidate.id,
          error: errorMessage,
        },
        '[domain_events] dispatch failed — incrementing attempts',
      )

      // Update failure metadata outside the failed tx (which was rolled back).
      // Use its own tenant-scoped transaction.
      try {
        await withSystemTx({ tenantId: candidate.tenant_id, branchId: null }, async (tx) => {
          await tx.execute(sql`
              UPDATE domain_events
              SET
                publish_attempts   = publish_attempts + 1,
                last_publish_error = ${errorMessage.slice(0, 500)}
              WHERE id = ${candidate.id}
            `)
        })
      } catch (updateErr) {
        logger.error(
          {
            worker: 'domainEventsPublisher',
            eventId: candidate.id,
            updateErr,
          },
          '[domain_events] failed to record dispatch failure',
        )
      }
    }
  }
}

// ─── Startup / shutdown ──────────────────────────────────────────────────────

let loopHandle: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (shuttingDown) return
  loopHandle = setTimeout(async () => {
    try {
      await pollOnce()
    } catch (err) {
      logger.error({ worker: 'domainEventsPublisher', err }, '[domain_events] poll error')
    }
    scheduleNext()
  }, POLL_INTERVAL_MS)
}

export function startDomainEventsPublisher(): void {
  logger.info(
    { worker: 'domainEventsPublisher', pollIntervalMs: POLL_INTERVAL_MS },
    '[domain_events] publisher worker started',
  )
  scheduleNext()
}

export function stopDomainEventsPublisher(): Promise<void> {
  return new Promise((resolve) => {
    shuttingDown = true
    if (loopHandle !== null) {
      clearTimeout(loopHandle)
      loopHandle = null
    }
    logger.info({ worker: 'domainEventsPublisher' }, '[domain_events] publisher worker stopped')
    resolve()
  })
}
