import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type { RequestHandler, Request } from 'express'
import { withTenantTx } from '../db/withTenantTx.js'

/**
 * Validates the Idempotency-Key header value.
 * 8–64 URL-safe characters (alphanumerics, hyphens, underscores).
 */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-zA-Z0-9\-_]+$/)

/**
 * Options for the idempotency middleware factory.
 *
 * @param tableName          The table that carries the idempotency key column
 *                           (e.g. 'transactions', 'payments', 'clinical_orders').
 * @param keyColumn          Column name in the table (default: 'idempotency_key').
 * @param statusColumn       Column holding the row's lifecycle state, or `null`
 *                           when the table has none. With `null`, the mere
 *                           EXISTENCE of the row means the operation completed,
 *                           which is the correct reading for a create endpoint:
 *                           the row is invisible until its transaction commits,
 *                           so a row that can be read is a finished write. Pass
 *                           `null` for `payments`, which has no `status` column
 *                           at all (only `reconciliation_status`).
 * @param terminalStatuses   Status values that mean the operation completed.
 *                           Compared case-insensitively, because Postgres enums
 *                           in this schema are capitalized (`Paid`, `Completed`)
 *                           while this list is conventionally lower-case.
 */
export type IdempotencyOptions = {
  tableName: string
  keyColumn?: string
  statusColumn?: string | null
  terminalStatuses?: string[]
}

const DEFAULT_TERMINAL_STATUSES = ['completed', 'paid', 'voided', 'cancelled', 'failed']

/**
 * Express middleware factory that implements Idempotency-Key replay protection.
 *
 * Behavior (only for state-changing methods with the header present):
 *
 * 1. Validates the key format (8–64 URL-safe chars).
 * 2. Queries `tableName` for a row matching `(tenant_id, keyColumn)`.
 * 3a. Found + terminal state: returns `{ id, idempotentReplay: true }` with
 *     status 200 and `X-Idempotent-Replay: true`. `id` is the row's
 *     `display_id` text (TXN_, PMT_, ORD_, …) when the table has one, falling
 *     back to the bigint PK stringified for tables that don't. This matches
 *     the shape consumer routes return on the first-write path, so a replayed
 *     response is indistinguishable from a fresh one for the caller.
 * 3b. Found + non-terminal state (in-flight): returns 409 with
 *     `code: 'IDEMPOTENCY_IN_FLIGHT'`.
 * 4.  Not found: attaches `req.idempotencyKey` and calls `next()`. The route
 *     handler is responsible for persisting the key when it writes the row.
 *
 * The middleware is intentionally minimal — it does NOT store or replay the
 * full HTTP response body. Consumer routes that need richer replay can inspect
 * `req.idempotencyKey` and/or query the returned `id` themselves.
 *
 * Mount AFTER auth + tenant middleware so `req.tenant` is available.
 */
export function idempotency(options: IdempotencyOptions): RequestHandler {
  const {
    tableName,
    keyColumn = 'idempotency_key',
    statusColumn = 'status',
    terminalStatuses = DEFAULT_TERMINAL_STATUSES,
  } = options
  // Case-folded once at factory time so the per-request check is a plain lookup.
  const terminalSet = new Set(terminalStatuses.map((v) => v.toLowerCase()))

  // Identifier safety guard: table and column names must be plain identifiers
  // (alphanumeric + underscores). They come from app code, not user input, but
  // this check makes misconfiguration fail loudly rather than silently.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`idempotency: invalid tableName "${tableName}"`)
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(keyColumn)) {
    throw new Error(`idempotency: invalid keyColumn "${keyColumn}"`)
  }
  if (statusColumn !== null && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(statusColumn)) {
    throw new Error(`idempotency: invalid statusColumn "${statusColumn}"`)
  }

  const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

  return async (req: Request, res, next) => {
    // Only gate state-changing requests.
    if (!STATE_CHANGING.has(req.method)) {
      return next()
    }

    const rawKey = req.get('idempotency-key')
    if (!rawKey) {
      // No header — pass through. The route can decide if the key is required.
      return next()
    }

    const parseResult = idempotencyKeySchema.safeParse(rawKey)
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid Idempotency-Key format (8–64 alphanumeric/-/_ chars)',
        code: 'IDEMPOTENCY_KEY_INVALID',
      })
      return
    }

    const key = parseResult.data
    const tenantId = req.tenant?.id

    if (!tenantId) {
      // Should never happen if tenant middleware is mounted first, but fail
      // loudly rather than silently skipping the check.
      res.status(500).json({ error: 'Tenant context missing', code: 'TENANT_MISSING' })
      return
    }

    try {
      // Look up the key within the caller's tenant.
      // Table and column identifiers are injected via sql.raw (they are
      // developer-supplied identifiers validated above, not user input).
      // The actual data values (tenantId, key) are parameterised.
      //
      // We also select `display_id` so the replay response surfaces the
      // public-facing handle when the table has one. The COALESCE-via-
      // `to_regclass` style would be cleaner, but every table currently
      // wired through this middleware (transactions, payments,
      // clinical_orders) has a display_id column, so we select it
      // unconditionally and let Postgres raise on the rare misconfigure —
      // matching the existing "fail loudly" guard above.
      type LookupRow = { id: string; display_id: string | null; status?: string | null }

      // Only select the status column when the table actually has one. Selecting
      // `status` from `payments` (which has only `reconciliation_status`) raised
      // Postgres 42703, which this function's catch turned into a blanket 500 —
      // so every request carrying an Idempotency-Key to the add-payment route
      // failed. Leading space on each appended fragment: sql.append inserts no
      // separator (see gotchas.md).
      const projection =
        statusColumn === null
          ? sql`SELECT id, display_id`
          : sql`SELECT id, display_id, `.append(sql.raw(statusColumn))

      // AUTH-2: withTenantTx sets the audit-trigger / RLS GUCs. userId=0 is
      // safe — this is SELECT-only and the audit trigger only fires on writes.
      // branchId=null (cross_branch_read=true) — the idempotency lookup must
      // find the prior row regardless of which branch the original request hit.
      const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
        tx.execute<LookupRow>(
          projection
            .append(sql` FROM `)
            .append(sql.raw(tableName))
            .append(sql` WHERE tenant_id = ${tenantId} AND `)
            .append(sql.raw(keyColumn))
            .append(sql` = ${key} LIMIT 1`),
        ),
      )

      const row: LookupRow | undefined = rows[0]

      if (row !== undefined) {
        // With no status column, an existing row IS the completed operation: it
        // could not be read unless its transaction had committed.
        const rawStatus = statusColumn === null ? null : (row[statusColumn as 'status'] ?? null)
        const isTerminal =
          statusColumn === null || (rawStatus !== null && terminalSet.has(rawStatus.toLowerCase()))
        if (isTerminal) {
          // Prefer display_id; fall back to stringified bigint for tables
          // (none today) that opt out of display_id columns.
          const publicId = row.display_id ?? String(row.id)
          res.setHeader('X-Idempotent-Replay', 'true')
          res.status(200).json({ id: publicId, idempotentReplay: true })
          return
        }
        // Row exists but not yet terminal — in-flight.
        res.status(409).json({
          error: 'Request is still being processed',
          code: 'IDEMPOTENCY_IN_FLIGHT',
        })
        return
      }

      // Key not found — attach it so the route can persist it on write.
      req.idempotencyKey = key
      return next()
    } catch (err) {
      // Log but don't surface internal details.
      console.error('[idempotency] lookup error', err)
      res.status(500).json({ error: 'Idempotency check failed', code: 'IDEMPOTENCY_ERROR' })
    }
  }
}

// Extend Express.Request so TypeScript knows about the attached key.
declare global {
  namespace Express {
    interface Request {
      idempotencyKey?: string
    }
  }
}
