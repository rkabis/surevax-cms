import { sql } from 'drizzle-orm'
import type { db } from '../../shared/db/index.js'
import type { DomainEventRow } from '../domainEventsPublisher.js'
import { logger } from '../../shared/utils/logger.js'

/**
 * Analytics upsert consumer: incrementally updates analytics.rollup_* tables
 * from domain events instead of relying on the full-scan refresh worker.
 *
 * Decision (defect audit, 2026-07-26): this file used to also carry
 * `upsertDosesAdministered` / `upsertInventoryMovement` / `upsertAppointmentOutcome`
 * branches for `ClinicalOrderAdministered` / `InventoryConsumed` / `AppointmentScheduled`.
 * All three were removed rather than repaired:
 *
 *   - Their raw SQL targeted columns that don't exist on the real
 *     `analytics.fact_doses_administered` / `fact_inventory_movements` /
 *     `fact_appointment_outcomes` tables (defined in
 *     `apps/backend/drizzle/0001_extensions_and_rls.sql`), so every write
 *     would throw, and since `dispatch()` runs this consumer inside the SAME
 *     transaction as `notificationConsumer`, that throw rolled back the whole
 *     per-row tx and burned the full `MAX_ATTEMPTS=20` backoff ladder
 *     (`domainEventsPublisher.ts`) before poison-pilling.
 *   - `analyticsRefresh.ts` (this repo's separate 5-minute batch worker)
 *     already populates the exact same three fact tables correctly, via a
 *     full join against the operational tables (`clinical_orders`,
 *     `inventory_movements`, `encounters`): the source of truth for columns
 *     these event payloads don't even carry (e.g. `lot_number` needs a join
 *     to `inventory_lots`, `encounter_id` / `dose_sequence` aren't on the
 *     `ClinicalOrderAdministered` payload at all).
 *   - Repairing the SQL in place would also risk a second, independent bug:
 *     the batch worker keys `fact_doses_administered.dose_id` off
 *     `clinical_orders.id` while this consumer only has the event's
 *     `aggregateId` (a `display_id`), so two different derivations racing to
 *     insert "the same" row under different keys would double-count doses
 *     in every downstream rollup, not just throw once.
 *
 *   Of the five original switch cases, only `TransactionCreated` /
 *   `TransactionPaid` / `PaymentReceived` are kept: `upsertDailyRevenue`
 *   recomputes `rollup_daily_branch_revenue` as an idempotent `SET =` (not
 *   `+=`) aggregate straight from the live `transactions` + `payments`
 *   tables for one `(tenant, branch, day)`, so it can't drift from what the
 *   batch worker would compute for that same day and gives same-day
 *   dashboards fresher-than-5-minutes numbers: a genuine event-driven win the
 *   batch worker can't offer. (`TransactionCreated`/`TransactionPaid`/
 *   `PaymentReceived` are not emitted anywhere yet, see
 *   `apps/backend/src/modules/scheduled_orders/service.ts` for the only
 *   live emitter, `ClinicalOrderAdministered`, but the branch is correct
 *   and ready for whenever the transactions module starts emitting them.)
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function analyticsConsumer(row: DomainEventRow, tx: Tx): Promise<void> {
  const p = row.payload as Record<string, unknown>

  switch (row.eventType) {
    case 'TransactionCreated':
    case 'TransactionPaid':
    case 'PaymentReceived': {
      await upsertDailyRevenue(row, p, tx)
      break
    }
    default:
      break
  }
}

async function upsertDailyRevenue(
  row: DomainEventRow,
  p: Record<string, unknown>,
  tx: Tx,
): Promise<void> {
  const branchId = (p.branchId as string) ?? ''
  const transactionDate = (p.transactionDate as string) ?? row.occurredAt.toISOString()

  // Guard: transactions always have a branch; skip if the event payload has none.
  if (!branchId) return

  const dateId = dateToDateId(new Date(transactionDate))
  await ensureDimDate(transactionDate, tx)

  // Compute the calendar date in Manila TZ (consistent with dateToDateId / WORK-5).
  const manilaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(transactionDate)) // 'YYYY-MM-DD'

  // Recompute the rollup for (tenant, branch, day) from the live transactions +
  // payments tables. Using SET = (not +=) makes this fully idempotent: both
  // TransactionCreated and TransactionPaid fire for the same transaction_id, but
  // each re-aggregate produces the same result, no double-count.
  //
  // fact_revenue (per-item grain) is NOT written here: it requires transaction_items
  // data that domain events don't carry. The analyticsRefresh worker populates
  // fact_revenue from operational tables on its 5-minute cycle.
  await tx.execute(sql`
    INSERT INTO analytics.rollup_daily_branch_revenue
      (tenant_id, branch_id, date_id,
       transaction_count, total_gross, total_discount, total_net,
       cash_net, card_net, other_net, refreshed_at)
    WITH day_txns AS (
      SELECT
        t.gross_amount::numeric    AS gross_amount,
        t.discount_amount::numeric AS discount_amount,
        t.net_amount::numeric      AS net_amount,
        (
          SELECT p.method
          FROM   payments p
          WHERE  p.transaction_id = t.id
          ORDER  BY p.received_at
          LIMIT  1
        ) AS first_method
      FROM  transactions t
      WHERE t.tenant_id      = ${row.tenantId}
        AND t.branch_id      = ${branchId}::bigint
        AND (t.transacted_at AT TIME ZONE 'Asia/Manila')::date = ${manilaDate}::date
        AND t.status         NOT IN ('Voided', 'Draft')
        AND t.deleted_at     IS NULL
        AND t.is_prepayment  = false
    )
    SELECT
      ${row.tenantId},
      ${branchId},
      ${dateId}::int,
      COUNT(*)::int                                                       AS transaction_count,
      COALESCE(SUM(gross_amount),    0)::numeric(12,2)                    AS total_gross,
      COALESCE(SUM(discount_amount), 0)::numeric(12,2)                    AS total_discount,
      COALESCE(SUM(net_amount),      0)::numeric(12,2)                    AS total_net,
      COALESCE(SUM(net_amount) FILTER (WHERE first_method = 'Cash'),   0)::numeric(12,2) AS cash_net,
      COALESCE(SUM(net_amount) FILTER (WHERE first_method = 'Card'),   0)::numeric(12,2) AS card_net,
      COALESCE(SUM(net_amount) FILTER (
        WHERE first_method NOT IN ('Cash', 'Card') OR first_method IS NULL
      ), 0)::numeric(12,2)                                                AS other_net,
      now()
    FROM day_txns
    ON CONFLICT (tenant_id, branch_id, date_id) DO UPDATE SET
      transaction_count = EXCLUDED.transaction_count,
      total_gross       = EXCLUDED.total_gross,
      total_discount    = EXCLUDED.total_discount,
      total_net         = EXCLUDED.total_net,
      cash_net          = EXCLUDED.cash_net,
      card_net          = EXCLUDED.card_net,
      other_net         = EXCLUDED.other_net,
      refreshed_at      = now()
  `)

  logger.debug(
    { eventType: row.eventType, aggregateId: row.aggregateId },
    '[analytics] upserted revenue rollup',
  )
}

// ─── Dimension helpers ────────────────────────────────────────────────────────

/**
 * WORK-5 fix: bucket by Asia/Manila (Philippine clinic tz) not server-local tz.
 * Early-morning Manila events (e.g. 00:30 PHT = 16:30 UTC previous day) were
 * bucketing to the wrong day when the server runs in UTC or another tz.
 */
const MANILA_TZ = 'Asia/Manila'

function dateToDateId(d: Date): number {
  // Use Intl.DateTimeFormat to extract the calendar date in Manila time.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const year = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'

  return parseInt(year + month + day, 10)
}

async function ensureDimDate(dateStr: string, tx: Tx): Promise<void> {
  const isoDate = new Date(dateStr).toISOString().slice(0, 10)
  const dateId = dateToDateId(new Date(dateStr))

  // dim_date is pre-seeded for 2020-01-01 → 2030-12-31. For dates in that
  // range this INSERT is a no-op (ON CONFLICT DO NOTHING). For out-of-range
  // dates (rare), we insert the row so the FK in fact_* tables resolves.
  // EXTRACT is used for iso_week / iso_year because their values differ from
  // calendar week/year at year boundaries and are easiest to compute in SQL.
  await tx.execute(sql`
    INSERT INTO analytics.dim_date
      (date_id, date, year, month, day, quarter, iso_week, iso_year, is_weekend)
    SELECT
      ${dateId}::int,
      ${isoDate}::date,
      EXTRACT(YEAR    FROM ${isoDate}::date)::int,
      EXTRACT(MONTH   FROM ${isoDate}::date)::int,
      EXTRACT(DAY     FROM ${isoDate}::date)::int,
      EXTRACT(QUARTER FROM ${isoDate}::date)::int,
      EXTRACT(WEEK    FROM ${isoDate}::date)::int,
      EXTRACT(ISOYEAR FROM ${isoDate}::date)::int,
      EXTRACT(ISODOW  FROM ${isoDate}::date) IN (6, 7)
    ON CONFLICT (date_id) DO NOTHING
  `)
}
