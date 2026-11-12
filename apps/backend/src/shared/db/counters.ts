/**
 * tenant_counters helpers — gapless monotonic allocation.
 *
 * All functions accept a Drizzle transaction (`tx`) from `withTenantTx` so
 * the lock + update are part of the caller's serialisable write.
 *
 * Branch-scoped counters: supply `branchId` (bigint number).
 * Tenant-wide counters:  omit `branchId` or pass `null`.
 *
 * Algorithm (allocateCounter):
 *   1. SELECT … FOR UPDATE — acquires row-level lock inside the caller's tx.
 *   2. If row exists:  UPDATE … SET current_value = current_value + 1 RETURNING current_value
 *   3. If row missing: INSERT … (current_value = 1) RETURNING current_value
 *
 * Returns the freshly allocated value (≥ 1).
 */

import { sql } from 'drizzle-orm'
import type { Tx } from './withTenantTx.js'

export type CounterArgs = {
  tenantId: string
  /** Bigint FK to branches.id (mode:'number'). Null = tenant-wide counter. */
  branchId: number | null
  counterKind: string
}

type CounterRow = { current_value: number }

/**
 * Allocate the next monotonically increasing value for this counter.
 * Must be called inside a `withTenantTx` transaction.
 * Returns the newly allocated integer value (starts at 1).
 */
export async function allocateCounter(tx: Tx, args: CounterArgs): Promise<number> {
  const { tenantId, branchId, counterKind } = args

  if (branchId !== null) {
    // Branch-scoped path — WHERE branch_id = $N
    const lockRows = await tx.execute<CounterRow>(
      sql`SELECT current_value
          FROM   tenant_counters
          WHERE  tenant_id    = ${tenantId}
            AND  branch_id    = ${branchId}
            AND  counter_kind = ${counterKind}
          FOR UPDATE`,
    )

    if (lockRows.length > 0) {
      const updated = await tx.execute<CounterRow>(
        sql`UPDATE tenant_counters
            SET    current_value = current_value + 1,
                   row_version   = row_version   + 1,
                   updated_at    = now()
            WHERE  tenant_id    = ${tenantId}
              AND  branch_id    = ${branchId}
              AND  counter_kind = ${counterKind}
            RETURNING current_value`,
      )
      return Number(updated[0]!.current_value)
    } else {
      const inserted = await tx.execute<CounterRow>(
        sql`INSERT INTO tenant_counters (tenant_id, branch_id, counter_kind, current_value, row_version)
            VALUES (${tenantId}, ${branchId}, ${counterKind}, 1, 0)
            ON CONFLICT DO NOTHING
            RETURNING current_value`,
      )
      if (inserted.length > 0) {
        return Number(inserted[0]!.current_value)
      }
      // Race: another tx inserted first — now lock and increment
      await tx.execute<CounterRow>(
        sql`SELECT current_value
            FROM   tenant_counters
            WHERE  tenant_id    = ${tenantId}
              AND  branch_id    = ${branchId}
              AND  counter_kind = ${counterKind}
            FOR UPDATE`,
      )
      const retryUpdate = await tx.execute<CounterRow>(
        sql`UPDATE tenant_counters
            SET    current_value = current_value + 1,
                   row_version   = row_version   + 1,
                   updated_at    = now()
            WHERE  tenant_id    = ${tenantId}
              AND  branch_id    = ${branchId}
              AND  counter_kind = ${counterKind}
            RETURNING current_value`,
      )
      return Number(retryUpdate[0]!.current_value)
    }
  } else {
    // Tenant-wide path — WHERE branch_id IS NULL
    const lockRows = await tx.execute<CounterRow>(
      sql`SELECT current_value
          FROM   tenant_counters
          WHERE  tenant_id    = ${tenantId}
            AND  branch_id    IS NULL
            AND  counter_kind = ${counterKind}
          FOR UPDATE`,
    )

    if (lockRows.length > 0) {
      const updated = await tx.execute<CounterRow>(
        sql`UPDATE tenant_counters
            SET    current_value = current_value + 1,
                   row_version   = row_version   + 1,
                   updated_at    = now()
            WHERE  tenant_id    = ${tenantId}
              AND  branch_id    IS NULL
              AND  counter_kind = ${counterKind}
            RETURNING current_value`,
      )
      return Number(updated[0]!.current_value)
    } else {
      const inserted = await tx.execute<CounterRow>(
        sql`INSERT INTO tenant_counters (tenant_id, branch_id, counter_kind, current_value, row_version)
            VALUES (${tenantId}, NULL, ${counterKind}, 1, 0)
            ON CONFLICT DO NOTHING
            RETURNING current_value`,
      )
      if (inserted.length > 0) {
        return Number(inserted[0]!.current_value)
      }
      // Race: another tx inserted first — lock and increment
      await tx.execute<CounterRow>(
        sql`SELECT current_value
            FROM   tenant_counters
            WHERE  tenant_id    = ${tenantId}
              AND  branch_id    IS NULL
              AND  counter_kind = ${counterKind}
            FOR UPDATE`,
      )
      const retryUpdate = await tx.execute<CounterRow>(
        sql`UPDATE tenant_counters
            SET    current_value = current_value + 1,
                   row_version   = row_version   + 1,
                   updated_at    = now()
            WHERE  tenant_id    = ${tenantId}
              AND  branch_id    IS NULL
              AND  counter_kind = ${counterKind}
            RETURNING current_value`,
      )
      return Number(retryUpdate[0]!.current_value)
    }
  }
}

/**
 * Non-locking peek at the current counter value.
 * Returns `null` if no counter row exists yet (no transactions issued).
 * Does NOT advance the counter.
 */
export async function peekCounter(tx: Tx, args: CounterArgs): Promise<number | null> {
  const { tenantId, branchId, counterKind } = args

  if (branchId !== null) {
    const result = await tx.execute<CounterRow>(
      sql`SELECT current_value
          FROM   tenant_counters
          WHERE  tenant_id    = ${tenantId}
            AND  branch_id    = ${branchId}
            AND  counter_kind = ${counterKind}`,
    )
    if (result.length === 0) return null
    return Number(result[0]!.current_value)
  } else {
    const result = await tx.execute<CounterRow>(
      sql`SELECT current_value
          FROM   tenant_counters
          WHERE  tenant_id    = ${tenantId}
            AND  branch_id    IS NULL
            AND  counter_kind = ${counterKind}`,
    )
    if (result.length === 0) return null
    return Number(result[0]!.current_value)
  }
}
