/**
 * Analytics Refresh Worker
 *
 * Populates analytics.fact_* / dim_* / rollup_* tables from operational tables.
 * Schema created by migration 0008_analytics_schema.sql (PR #129).
 *
 * Gates:
 *   WORKERS_ENABLED=true            (shared with domainEventsPublisher)
 *   ANALYTICS_REFRESH_ENABLED=true  (opt-in, analytics tables may not exist yet)
 *
 * Interval: configurable via ANALYTICS_REFRESH_INTERVAL_MS (default 5 minutes).
 *
 * Each refresh phase runs in its own db.transaction. Analytics tables have no
 * RLS, so no tenant GUC is needed. Source queries that touch tenant-scoped tables
 * are cross-tenant (no WHERE clause on tenant_id unless explicitly scoped):
 * the analytics layer aggregates across all tenants and is accessed by the
 * application, never directly by end-users through RLS-enforced connections.
 *
 * Graceful shutdown: SIGTERM cancels the pending setTimeout and lets any
 * in-flight refresh complete before the process exits.
 *
 * Errors are logged via pino and swallowed, the worker never crashes the
 * parent process. Next interval retries automatically.
 *
 * Cross-instance safety (2026-07-26 fix): Railway can run more than one
 * instance of this backend, each ticking this worker's 5-minute loop on its
 * own schedule. Two instances racing the same phase used to be able to both
 * pass an `INSERT ... SELECT ... WHERE NOT EXISTS (...)` guard and have the
 * second hit a duplicate-key error (append-only fact tables, real primary
 * keys), or both TRUNCATE+rebuild the same rollup table back to back. Every
 * mutating phase now opens with `pg_try_advisory_xact_lock` (mirrors the
 * `pg_advisory_xact_lock(hashtext(...))` shape already used in
 * `modules/transactions/db.ts` for pay-on-account, and the same
 * skip-rather-than-block spirit as the `FOR UPDATE SKIP LOCKED` fix in
 * `domainEventsPublisher.ts`, WORK-2): if a same-named lock is already held by
 * a concurrent instance, this phase is skipped for the current cycle and
 * retried on the next tick, which is safe because every phase here is
 * idempotent (append-only NOT EXISTS, or full TRUNCATE+rebuild). The
 * transaction-scoped variant auto-releases at commit, so no explicit unlock
 * is needed. The append-only fact INSERTs additionally carry
 * `ON CONFLICT ... DO NOTHING` as an independent, cheap safety net for the
 * same race, in case a rolling deploy leaves an older, lock-less instance
 * running alongside a new one.
 */

import { sql } from 'drizzle-orm'
import { withPlatformTx, type Tx } from '../shared/db/withTenantTx.js'
import { logger } from '../shared/utils/logger.js'

const REFRESH_INTERVAL_MS = parseInt(
  process.env.ANALYTICS_REFRESH_INTERVAL_MS ?? String(5 * 60 * 1000),
  10,
)

/**
 * Clinic timezone for calendar-day bucketing (`date_id` = YYYYMMDD in this
 * zone). Hardcoded to match the precedent already set in
 * `domainEventConsumers/analyticsConsumer.ts` (`MANILA_TZ`, the WORK-5 fix)
 * rather than reading it per-tenant: Phase 1 is single-clinic (SVX, Asia/Manila)
 * and every other cross-tenant query in this file already aggregates without
 * a tenant scope. `tenants.timezone` / `branches.timezone` columns exist
 * (default `'Asia/Manila'`) for exactly this purpose; when tenant #2 onboards
 * in a different timezone, this is the constant to replace with a per-row
 * `tenants.timezone` join in each of the four `to_char(..., 'YYYYMMDD')`
 * date_id computations below.
 */
const ANALYTICS_TZ = 'Asia/Manila'

/**
 * Cross-instance mutex for one refresh phase. Non-blocking: returns `false`
 * immediately (instead of waiting) when another instance already holds the
 * same-named lock, so the caller can skip this phase for the current cycle
 * rather than stack up waiting instances. Transaction-scoped: releases
 * automatically when `tx`'s transaction commits or rolls back.
 */
async function tryLockPhase(tx: Tx, phase: string): Promise<boolean> {
  const rows = await tx.execute<{ locked: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtext(${'analytics_refresh:' + phase})) AS locked`,
  )
  return rows[0]?.locked ?? false
}

// ─── Dimension refresh ───────────────────────────────────────────────────────

/**
 * Refresh dim_service from service_catalog.
 *
 * SCD-2-lite: if name or service_type has changed on an active row,
 * expire the old row (valid_to = now()) and insert a new current row.
 * Genuinely new services are inserted as current rows.
 */
async function refreshDimService(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    // Expire rows where tracked attributes have changed
    await tx.execute(sql`
      UPDATE analytics.dim_service ds
      SET    valid_to   = now(),
             updated_at = now()
      FROM   service_catalog sc
      WHERE  sc.id = ds.service_key
        AND  ds.valid_to IS NULL
        AND  sc.deleted_at IS NULL
        AND (
              sc.name         IS DISTINCT FROM ds.service_name
           OR sc.service_type IS DISTINCT FROM ds.service_type
           OR sc.is_active    IS DISTINCT FROM ds.is_active
        )
    `)

    // Insert new current row for expired rows + brand-new services
    await tx.execute(sql`
      INSERT INTO analytics.dim_service
        (service_key, tenant_id, service_name, service_type, is_active, valid_from, valid_to, updated_at)
      SELECT
        sc.id,
        sc.tenant_id,
        sc.name,
        sc.service_type::text,
        sc.is_active,
        now(),
        NULL,
        now()
      FROM service_catalog sc
      WHERE sc.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM analytics.dim_service ds
          WHERE ds.service_key = sc.id
            AND ds.valid_to IS NULL
        )
    `)
  })
}

/**
 * Refresh dim_user from users table.
 *
 * SCD-2-lite: expire + re-insert when role, primary_branch_id, or is_active changes.
 */
async function refreshDimUser(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    // WORK-1 fix: users.role was dropped in #217. Project role via user_roles join
    // using the same CASE-rank precedence as userPrimaryRoleSql in userViews.ts.
    await tx.execute(sql`
      UPDATE analytics.dim_user du
      SET    valid_to   = now(),
             updated_at = now()
      FROM   users u
      LEFT JOIN LATERAL (
        SELECT role::text AS role
        FROM   user_roles
        WHERE  user_id = u.id
        ORDER BY CASE role::text
          WHEN 'TenantAdmin' THEN 1
          WHEN 'SuperAdmin'  THEN 2
          WHEN 'BranchAdmin' THEN 3
          WHEN 'Branch'      THEN 4
          WHEN 'Physician'   THEN 5
          WHEN 'Nurse'       THEN 6
          WHEN 'Cashier'     THEN 7
          ELSE 99
        END
        LIMIT 1
      ) ur ON true
      WHERE  u.id = du.user_key
        AND  du.valid_to IS NULL
        AND (
              (u.first_name || ' ' || u.last_name) IS DISTINCT FROM du.full_name
           OR ur.role                               IS DISTINCT FROM du.role
           OR u.primary_branch_id                   IS DISTINCT FROM du.primary_branch_id
           OR u.is_active                            IS DISTINCT FROM du.is_active
        )
    `)

    await tx.execute(sql`
      INSERT INTO analytics.dim_user
        (user_key, tenant_id, full_name, role, primary_branch_id, is_active, valid_from, valid_to, updated_at)
      SELECT
        u.id,
        u.tenant_id,
        u.first_name || ' ' || u.last_name,
        (
          SELECT role::text FROM user_roles
          WHERE  user_id = u.id
          ORDER BY CASE role::text
            WHEN 'TenantAdmin' THEN 1
            WHEN 'SuperAdmin'  THEN 2
            WHEN 'BranchAdmin' THEN 3
            WHEN 'Branch'      THEN 4
            WHEN 'Physician'   THEN 5
            WHEN 'Nurse'       THEN 6
            WHEN 'Cashier'     THEN 7
            ELSE 99
          END
          LIMIT 1
        )                    AS role,
        u.primary_branch_id,
        u.is_active,
        now(),
        NULL,
        now()
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1
        FROM analytics.dim_user du
        WHERE du.user_key = u.id
          AND du.valid_to IS NULL
      )
    `)
  })
}

/**
 * Refresh dim_patient from patients table.
 *
 * NO PHI: stores age_band (derived from DOB), sex, barangay, city only.
 * SCD-2-lite: expire + re-insert when tracked attributes change.
 */
async function refreshDimPatient(): Promise<void> {
  // age_band CTE keeps the CASE expression in one place for both UPDATE and INSERT.
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    await tx.execute(sql`
      WITH src AS (
        SELECT
          p.id,
          p.tenant_id,
          CASE
            WHEN p.date_of_birth IS NULL THEN 'unknown'
            WHEN EXTRACT(YEAR FROM age(p.date_of_birth::date)) < 5   THEN '0-4'
            WHEN EXTRACT(YEAR FROM age(p.date_of_birth::date)) < 12  THEN '5-11'
            WHEN EXTRACT(YEAR FROM age(p.date_of_birth::date)) < 18  THEN '12-17'
            WHEN EXTRACT(YEAR FROM age(p.date_of_birth::date)) < 60  THEN '18-59'
            ELSE '60+'
          END                 AS age_band,
          p.sex::text         AS sex,
          p.barangay,
          p.city,
          p.is_active
        FROM patients p
        WHERE p.deleted_at IS NULL
      ),
      expired AS (
        UPDATE analytics.dim_patient dp
        SET    valid_to   = now(),
               updated_at = now()
        FROM   src
        WHERE  src.id = dp.patient_key
          AND  dp.valid_to IS NULL
          AND (
                src.age_band   IS DISTINCT FROM dp.age_band
             OR src.sex        IS DISTINCT FROM dp.sex
             OR src.barangay   IS DISTINCT FROM dp.barangay
             OR src.city       IS DISTINCT FROM dp.city
             OR src.is_active  IS DISTINCT FROM dp.is_active
          )
        RETURNING dp.patient_key
      )
      INSERT INTO analytics.dim_patient
        (patient_key, tenant_id, age_band, sex, barangay, city, is_active, valid_from, valid_to, updated_at)
      SELECT
        src.id,
        src.tenant_id,
        src.age_band,
        src.sex,
        src.barangay,
        src.city,
        src.is_active,
        now(),
        NULL,
        now()
      FROM src
      WHERE NOT EXISTS (
        SELECT 1
        FROM analytics.dim_patient dp
        WHERE dp.patient_key = src.id
          AND dp.valid_to IS NULL
      )
    `)
  })
}

// ─── Fact refresh ────────────────────────────────────────────────────────────

/**
 * Append new fact_doses_administered rows.
 * Grain: one row per completed/administered clinical_order (vaccine dose).
 */
async function refreshFactDosesAdministered(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    if (!(await tryLockPhase(tx, 'fact_doses_administered'))) {
      logger.debug(
        { worker: 'analyticsRefresh', phase: 'fact_doses_administered' },
        '[analytics] skipped, locked by concurrent instance',
      )
      return
    }

    await tx.execute(sql`
      INSERT INTO analytics.fact_doses_administered
        (dose_id, tenant_id, date_id, patient_key, service_key,
         administered_by_key, branch_id, encounter_id, dose_sequence,
         lot_number, administered_at, refreshed_at)
      SELECT
        co.id                                               AS dose_id,
        co.tenant_id,
        to_char(co.completed_at AT TIME ZONE ${ANALYTICS_TZ}, 'YYYYMMDD')::INT AS date_id,
        co.patient_id                                       AS patient_key,
        co.service_id                                       AS service_key,
        COALESCE(co.administered_by_id, co.documented_by_id) AS administered_by_key,
        COALESCE(e.branch_id::text, '')                     AS branch_id,
        co.encounter_id,
        co.dose_number                                      AS dose_sequence,
        il.batch_number                                     AS lot_number,
        co.completed_at                                     AS administered_at,
        now()                                               AS refreshed_at
      FROM clinical_orders co
      LEFT JOIN encounters e
        ON e.id = co.encounter_id
      LEFT JOIN inventory_lots il
        ON il.id = co.lot_id
      WHERE co.status = 'Completed'
        AND co.completed_at IS NOT NULL
        AND co.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM analytics.fact_doses_administered fda
          WHERE fda.dose_id = co.id::text
        )
      ON CONFLICT (dose_id) DO NOTHING
    `)
  })
}

/**
 * Append new fact_revenue rows.
 * Grain: one row per transaction_items line item.
 */
async function refreshFactRevenue(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    if (!(await tryLockPhase(tx, 'fact_revenue'))) {
      logger.debug(
        { worker: 'analyticsRefresh', phase: 'fact_revenue' },
        '[analytics] skipped, locked by concurrent instance',
      )
      return
    }

    await tx.execute(sql`
      INSERT INTO analytics.fact_revenue
        (revenue_id, tenant_id, date_id, transaction_id, patient_key,
         service_key, cashier_key, branch_id, quantity, unit_price,
         discount_amount, net_amount, payment_method, discount_type,
         transacted_at, refreshed_at)
      SELECT
        ti.id                                                           AS revenue_id,
        ti.tenant_id,
        to_char(t.transacted_at AT TIME ZONE ${ANALYTICS_TZ}, 'YYYYMMDD')::INT AS date_id,
        ti.transaction_id,
        t.patient_id                                                    AS patient_key,
        ti.service_id                                                   AS service_key,
        t.cashier_id                                                    AS cashier_key,
        t.branch_id,
        ti.quantity::INT,
        ti.unit_price,
        ti.discount_amount,
        ti.subtotal                                                     AS net_amount,
        first_pay.method::text                                          AS payment_method,
        t.discount_id_type::text                                        AS discount_type,
        t.transacted_at,
        now()                                                           AS refreshed_at
      FROM transaction_items ti
      JOIN transactions t
        ON t.id = ti.transaction_id
      LEFT JOIN LATERAL (
        -- A voided payment is a corrected-and-replaced row: excluding it here
        -- keeps the analytics fact attributed to the method that actually
        -- stuck, not a superseded one.
        SELECT p.method
        FROM payments p
        WHERE p.transaction_id = t.id
          AND p.voided_at IS NULL
        ORDER BY p.received_at
        LIMIT 1
      ) first_pay ON true
      WHERE t.status NOT IN ('Voided', 'Draft')
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM analytics.fact_revenue fr
          WHERE fr.revenue_id = ti.id::text
        )
      ON CONFLICT (revenue_id) DO NOTHING
    `)
  })
}

/**
 * Append new fact_inventory_movements rows.
 * Grain: one row per inventory_movements journal entry.
 */
async function refreshFactInventoryMovements(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    if (!(await tryLockPhase(tx, 'fact_inventory_movements'))) {
      logger.debug(
        { worker: 'analyticsRefresh', phase: 'fact_inventory_movements' },
        '[analytics] skipped, locked by concurrent instance',
      )
      return
    }

    await tx.execute(sql`
      INSERT INTO analytics.fact_inventory_movements
        (movement_id, tenant_id, date_id, service_key, branch_id,
         movement_type, quantity_delta, lot_number, expiry_date,
         cost_per_unit, moved_at, refreshed_at)
      SELECT
        im.id                                                            AS movement_id,
        im.tenant_id,
        to_char(im.performed_at AT TIME ZONE ${ANALYTICS_TZ}, 'YYYYMMDD')::INT AS date_id,
        svc.service_key                                                  AS service_key,
        im.branch_id,
        im.movement_type::text,
        im.quantity_delta::INT,
        il.batch_number                                                  AS lot_number,
        il.expiry_date,
        im.unit_cost_snapshot                                            AS cost_per_unit,
        im.performed_at                                                  AS moved_at,
        now()                                                            AS refreshed_at
      FROM inventory_movements im
      JOIN inventory_lots il
        ON il.id = im.lot_id
      -- inventory_lots has no service_id column (it only carries product_id):
      -- resolve the lot's product to an abstract service the same way the
      -- catalog eligibility model does, preferring the service_eligible_products
      -- junction's default/highest-ranked mapping and falling back to the
      -- legacy single-product service_catalog.product_id link.
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (
            SELECT sep.service_id
            FROM service_eligible_products sep
            WHERE sep.tenant_id = im.tenant_id
              AND sep.product_id = il.product_id
            ORDER BY sep.is_default DESC, sep.ranking ASC
            LIMIT 1
          ),
          (
            SELECT sc.id
            FROM service_catalog sc
            WHERE sc.tenant_id = im.tenant_id
              AND sc.product_id = il.product_id
            LIMIT 1
          )
        ) AS service_key
      ) svc ON true
      WHERE svc.service_key IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM analytics.fact_inventory_movements fim
          WHERE fim.movement_id = im.id::text
        )
      ON CONFLICT (movement_id) DO NOTHING
    `)
  })
}

/**
 * Append new fact_appointment_outcomes rows.
 * Grain: one row per encounter.
 */
async function refreshFactAppointmentOutcomes(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    if (!(await tryLockPhase(tx, 'fact_appointment_outcomes'))) {
      logger.debug(
        { worker: 'analyticsRefresh', phase: 'fact_appointment_outcomes' },
        '[analytics] skipped, locked by concurrent instance',
      )
      return
    }

    await tx.execute(sql`
      INSERT INTO analytics.fact_appointment_outcomes
        (outcome_id, tenant_id, date_id, patient_key, service_key,
         provider_key, branch_id, outcome_status, wait_minutes,
         duration_minutes, booked_at, occurred_at, refreshed_at)
      SELECT
        e.id                                                             AS outcome_id,
        e.tenant_id,
        to_char(e.started_at AT TIME ZONE ${ANALYTICS_TZ}, 'YYYYMMDD')::INT AS date_id,
        e.patient_id                                                     AS patient_key,
        NULL                                                             AS service_key,
        e.provider_id                                                    AS provider_key,
        e.branch_id,
        CASE e.status
          WHEN 'Completed'  THEN 'completed'
          WHEN 'Cancelled'  THEN 'cancelled'
          ELSE 'completed'
        END                                                              AS outcome_status,
        NULL::INT                                                        AS wait_minutes,
        CASE
          WHEN e.completed_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (e.completed_at - e.started_at))::INT / 60
          ELSE NULL
        END                                                              AS duration_minutes,
        NULL::TIMESTAMPTZ                                                AS booked_at,
        e.started_at                                                     AS occurred_at,
        now()                                                            AS refreshed_at
      FROM encounters e
      WHERE e.status IN ('Completed', 'Cancelled')
        AND e.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM analytics.fact_appointment_outcomes fao
          WHERE fao.outcome_id = e.id::text
        )
      ON CONFLICT (outcome_id) DO NOTHING
    `)
  })
}

// ─── Rollup refresh ──────────────────────────────────────────────────────────

/**
 * Full-refresh rollup_daily_branch_revenue.
 * Small table: TRUNCATE + INSERT is safe and simple.
 */
async function refreshRollupDailyBranchRevenue(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    if (!(await tryLockPhase(tx, 'rollup_daily_branch_revenue'))) {
      logger.debug(
        { worker: 'analyticsRefresh', phase: 'rollup_daily_branch_revenue' },
        '[analytics] skipped, locked by concurrent instance',
      )
      return
    }

    await tx.execute(sql`TRUNCATE analytics.rollup_daily_branch_revenue`)

    await tx.execute(sql`
      INSERT INTO analytics.rollup_daily_branch_revenue
        (tenant_id, branch_id, date_id,
         transaction_count, total_gross, total_discount, total_net,
         cash_net, card_net, other_net, refreshed_at)
      SELECT
        fr.tenant_id,
        fr.branch_id,
        fr.date_id,
        COUNT(DISTINCT fr.transaction_id)                AS transaction_count,
        SUM(fr.unit_price * fr.quantity)                 AS total_gross,
        SUM(fr.discount_amount)                          AS total_discount,
        SUM(fr.net_amount)                               AS total_net,
        COALESCE(SUM(fr.net_amount) FILTER (
          WHERE fr.payment_method = 'Cash'
        ), 0)                                            AS cash_net,
        COALESCE(SUM(fr.net_amount) FILTER (
          WHERE fr.payment_method = 'Card'
        ), 0)                                            AS card_net,
        COALESCE(SUM(fr.net_amount) FILTER (
          WHERE fr.payment_method NOT IN ('Cash', 'Card')
            OR  fr.payment_method IS NULL
        ), 0)                                            AS other_net,
        now()                                            AS refreshed_at
      FROM analytics.fact_revenue fr
      GROUP BY fr.tenant_id, fr.branch_id, fr.date_id
    `)
  })
}

/**
 * Full-refresh rollup_daily_doses_by_service.
 */
async function refreshRollupDailyDosesByService(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    if (!(await tryLockPhase(tx, 'rollup_daily_doses_by_service'))) {
      logger.debug(
        { worker: 'analyticsRefresh', phase: 'rollup_daily_doses_by_service' },
        '[analytics] skipped, locked by concurrent instance',
      )
      return
    }

    await tx.execute(sql`TRUNCATE analytics.rollup_daily_doses_by_service`)

    await tx.execute(sql`
      INSERT INTO analytics.rollup_daily_doses_by_service
        (tenant_id, branch_id, date_id, service_key,
         doses_administered, unique_patients, refreshed_at)
      SELECT
        fda.tenant_id,
        fda.branch_id,
        fda.date_id,
        fda.service_key,
        COUNT(*)                         AS doses_administered,
        COUNT(DISTINCT fda.patient_key)  AS unique_patients,
        now()                            AS refreshed_at
      FROM analytics.fact_doses_administered fda
      GROUP BY fda.tenant_id, fda.branch_id, fda.date_id, fda.service_key
    `)
  })
}

/**
 * Full-refresh rollup_monthly_provider_productivity.
 */
async function refreshRollupMonthlyProviderProductivity(): Promise<void> {
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    if (!(await tryLockPhase(tx, 'rollup_monthly_provider_productivity'))) {
      logger.debug(
        { worker: 'analyticsRefresh', phase: 'rollup_monthly_provider_productivity' },
        '[analytics] skipped, locked by concurrent instance',
      )
      return
    }

    await tx.execute(sql`TRUNCATE analytics.rollup_monthly_provider_productivity`)

    await tx.execute(sql`
      INSERT INTO analytics.rollup_monthly_provider_productivity
        (tenant_id, branch_id, year_month, provider_key,
         encounters_completed, doses_administered, unique_patients,
         avg_encounter_minutes, refreshed_at)
      SELECT
        fao.tenant_id,
        fao.branch_id,
        -- date_id is YYYYMMDD::INT; extract YYYY-MM without joining dim_date
        to_char(to_date(fao.date_id::text, 'YYYYMMDD'), 'YYYY-MM') AS year_month,
        fao.provider_key,
        COUNT(DISTINCT fao.outcome_id)           AS encounters_completed,
        COUNT(DISTINCT fda.dose_id)              AS doses_administered,
        COUNT(DISTINCT fao.patient_key)          AS unique_patients,
        ROUND(AVG(fao.duration_minutes), 1)      AS avg_encounter_minutes,
        now()                                    AS refreshed_at
      FROM analytics.fact_appointment_outcomes fao
      LEFT JOIN analytics.fact_doses_administered fda
        ON fda.encounter_id = fao.outcome_id
      WHERE fao.provider_key IS NOT NULL
      GROUP BY fao.tenant_id, fao.branch_id,
               to_char(to_date(fao.date_id::text, 'YYYYMMDD'), 'YYYY-MM'),
               fao.provider_key
    `)
  })
}

// ─── Materialized view ───────────────────────────────────────────────────────

async function refreshMvPatientProtocolCompletion(): Promise<void> {
  // AUTH-2: withPlatformTx so the connection has is_platform_admin=true when the
  // REFRESH command runs on the underlying tenant-scoped source tables.
  await withPlatformTx({ platformUserId: -1 }, async (tx) => {
    await tx.execute(
      sql`REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.mv_patient_protocol_completion`,
    )
  })
}

// ─── Full refresh cycle ──────────────────────────────────────────────────────

async function runRefresh(): Promise<void> {
  const start = Date.now()
  logger.info({ worker: 'analyticsRefresh' }, '[analytics] starting refresh cycle')

  // Phase 1: dimensions (must run before facts reference dim keys)
  await refreshDimService()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] dim_service refreshed')

  await refreshDimUser()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] dim_user refreshed')

  await refreshDimPatient()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] dim_patient refreshed')

  // Phase 2: facts (append-new)
  await refreshFactDosesAdministered()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] fact_doses_administered refreshed')

  await refreshFactRevenue()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] fact_revenue refreshed')

  await refreshFactInventoryMovements()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] fact_inventory_movements refreshed')

  await refreshFactAppointmentOutcomes()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] fact_appointment_outcomes refreshed')

  // Phase 3: rollups (full-refresh: small tables, always consistent)
  await refreshRollupDailyBranchRevenue()
  logger.debug({ worker: 'analyticsRefresh' }, '[analytics] rollup_daily_branch_revenue refreshed')

  await refreshRollupDailyDosesByService()
  logger.debug(
    { worker: 'analyticsRefresh' },
    '[analytics] rollup_daily_doses_by_service refreshed',
  )

  await refreshRollupMonthlyProviderProductivity()
  logger.debug(
    { worker: 'analyticsRefresh' },
    '[analytics] rollup_monthly_provider_productivity refreshed',
  )

  // Phase 4: materialized view
  await refreshMvPatientProtocolCompletion()
  logger.debug(
    { worker: 'analyticsRefresh' },
    '[analytics] mv_patient_protocol_completion refreshed',
  )

  const durationMs = Date.now() - start
  logger.info({ worker: 'analyticsRefresh', durationMs }, '[analytics] refresh cycle complete')
}

// ─── Startup / shutdown ──────────────────────────────────────────────────────

let shuttingDown = false
let loopHandle: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (shuttingDown) return
  loopHandle = setTimeout(async () => {
    try {
      await runRefresh()
    } catch (err) {
      // Never crash the worker: log and retry on the next interval.
      logger.error({ worker: 'analyticsRefresh', err }, '[analytics] refresh cycle error')
    }
    scheduleNext()
  }, REFRESH_INTERVAL_MS)
}

export function startAnalyticsRefresh(): void {
  logger.info(
    { worker: 'analyticsRefresh', intervalMs: REFRESH_INTERVAL_MS },
    '[analytics] refresh worker started',
  )
  scheduleNext()
}

export function stopAnalyticsRefresh(): Promise<void> {
  return new Promise((resolve) => {
    shuttingDown = true
    if (loopHandle !== null) {
      clearTimeout(loopHandle)
      loopHandle = null
    }
    logger.info({ worker: 'analyticsRefresh' }, '[analytics] refresh worker stopped')
    resolve()
  })
}
