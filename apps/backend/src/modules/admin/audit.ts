import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq, desc, ilike, or, sql, count } from 'drizzle-orm'
import { z } from 'zod'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { auditLogs, branches, users } from '../../shared/db/schema.js'
import { userPrimaryRoleSql } from '../../shared/db/userViews.js'

export const adminAuditRouter: RouterType = Router()

// Cross-Branch PHI RFC Step 6 (reconciled): this admin endpoint reads
// `audit_logs` tenant-wide (scoped only by `tenant_id`, not branch). This is
// ADMIN OPERATIONAL cross-branch — NOT clinical break-glass. It does NOT emit a
// `cross_branch_access_grants` row: grants are reserved for genuine PHI chart
// break-glass (patients_demographic_v Tier-2 reveal, D1). `audit_logs` is one
// of the five tables with a NULLABLE `branch_id`, so the `branch_isolation`
// USING clause's `branch_id IS NULL` disjunct keeps tenant-wide reference rows
// visible. The RFC §4.4 synthetic-"Quality_review"-grant approach was rejected
// — bolting break-glass grant rows onto admin reads would pollute the
// compliance review surface. All reads run inside withTenantTx (branchId null
// = tenant-wide admin read): under FORCE RLS a bare read has no
// app.current_tenant_id GUC and returns zero rows (2026-06-12 review Theme B).

type ActionFilter = 'all' | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'TRANSACTION_MODIFY'
const VALID_ACTIONS = new Set(['all', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'TRANSACTION_MODIFY'])

/**
 * Cursor encoding: base64("<timestamp_iso>|<bigint_id>")
 * Ordering: (timestamp DESC, id DESC) for stability.
 * The id is the internal bigint — audit_logs.id is bigserial-only (no
 * display_id, per spec). It is an opaque server pagination token.
 * TODO Phase 2: switch X-Total-Count to estimated count via pg_stat or
 * materialized view if scale warrants.
 */
function encodeCursor(timestamp: Date, id: number): string {
  return Buffer.from(`${timestamp.toISOString()}|${id}`).toString('base64')
}

function decodeCursor(cursor: string): { ts: Date; id: number } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8')
    const pipe = raw.lastIndexOf('|')
    if (pipe === -1) return null
    const id = parseInt(raw.slice(pipe + 1), 10)
    if (!Number.isFinite(id)) return null
    return { ts: new Date(raw.slice(0, pipe)), id }
  } catch {
    return null
  }
}

const listQuerySchema = z.object({
  q: z.string().optional(),
  action: z.string().optional(),
  // sessionId in audit_logs is bigint internal — accept it as a numeric string.
  sessionId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * Sensitive top-level keys that must never leave the API even if they're somehow
 * present in a `changes` JSONB row (e.g. legacy rows written before the
 * `0002_audit_redaction.sql` migration redacted at write-time). Mirrors the
 * trigger deny-list — keep in sync.
 */
const SENSITIVE_KEYS = new Set([
  'password_hash',
  'token_hash',
  'allergies',
  'conditions',
  'contact_number',
  'first_name',
  'last_name',
  'middle_name',
  'preferred_name',
  'full_name',
  'mrn',
  'email',
  'address',
  'barangay',
  'city',
  'province',
  'date_of_birth',
  'guardian_name',
  'guardian_contact',
  'guardian_relationship',
  'insurance_policy_number',
  'insurance_provider',
  'api_key',
  'api_secret',
  'api_config',
  'credentials',
  'token',
  'details',
])

/** Recursively replace SENSITIVE_KEYS values with '[REDACTED]'. */
function redactChanges(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactChanges)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : redactChanges(v)
  }
  return out
}

/** GET /api/admin/audit — audit log entries with user details */
adminAuditRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id

  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PARAMS', details: parsed.error.flatten() })
    return
  }

  const { q, action: actionParam, sessionId, cursor, limit } = parsed.data
  const action = VALID_ACTIONS.has(actionParam ?? 'all')
    ? ((actionParam as ActionFilter) ?? 'all')
    : 'all'

  // Filter conditions (excluding cursor — used for total count)
  const filterConditions = [eq(auditLogs.tenantId, tenantId)]

  if (q) {
    // Search by user name only. We deliberately do NOT search the JSONB
    // `changes` column: it can contain redacted-but-historically-present PII
    // (pre-0002 rows), and even post-redaction it would expose attacker-
    // controlled substring matches. Filter by user/action/date instead.
    const pattern = `%${q}%`
    filterConditions.push(or(ilike(users.firstName, pattern), ilike(users.lastName, pattern))!)
  }

  if (action !== 'all') {
    filterConditions.push(eq(auditLogs.action, action))
  }

  if (sessionId) {
    const sessionIdNum = parseInt(sessionId, 10)
    if (Number.isFinite(sessionIdNum)) {
      filterConditions.push(eq(auditLogs.sessionId, sessionIdNum))
    }
  }

  // Cursor conditions (added on top of filters for the page query)
  const pageConditions = [...filterConditions]
  if (cursor) {
    const decoded = decodeCursor(cursor)
    if (decoded) {
      pageConditions.push(
        sql`(${auditLogs.timestamp}, ${auditLogs.id}) < (${decoded.ts.toISOString()}::timestamptz, ${decoded.id})`,
      )
    }
  }

  const [rows, [countRow]] = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) =>
      Promise.all([
        tx
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            entityType: auditLogs.entityType,
            // entity_id is the audited row's display_id (text, per spec #9).
            entityId: auditLogs.entityId,
            sessionId: auditLogs.sessionId,
            correlationId: auditLogs.correlationId,
            ipAddress: auditLogs.ipAddress,
            changes: auditLogs.changes,
            metadata: auditLogs.metadata,
            timestamp: auditLogs.timestamp,
            userDisplayId: users.displayId,
            userFirstName: users.firstName,
            userLastName: users.lastName,
          })
          .from(auditLogs)
          .leftJoin(users, eq(auditLogs.userId, users.id))
          .where(and(...pageConditions))
          .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
          .limit(limit + 1),
        tx
          .select({ total: count() })
          .from(auditLogs)
          // Same LEFT JOIN as the page query — `filterConditions` may reference
          // users.firstName/lastName when ?q= is set; without the join Postgres
          // raises "missing FROM-clause entry for table 'users'".
          .leftJoin(users, eq(auditLogs.userId, users.id))
          .where(and(...filterConditions)),
      ]),
  )

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.timestamp, last.id) : null
  const totalCount = countRow?.total ?? 0

  res.set('X-Total-Count', String(totalCount))
  if (nextCursor) res.set('X-Next-Cursor', nextCursor)
  res.json({
    data: data.map((r) => ({
      id: String(r.id),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      sessionId: r.sessionId !== null ? String(r.sessionId) : null,
      correlationId: r.correlationId,
      // Legacy string field — kept for backward compat; prefer structured `actor`
      userName: r.userFirstName ? `${r.userFirstName} ${r.userLastName}` : 'System',
      // Structured actor: displayId + resolved name for <UserLabel> rendering
      actor: r.userDisplayId
        ? {
            displayId: r.userDisplayId,
            firstName: r.userFirstName ?? '',
            lastName: r.userLastName ?? '',
          }
        : null,
      description: describeAuditEntry(r),
      ipAddress: r.ipAddress,
      metadata: r.metadata,
      timestamp: r.timestamp.toISOString(),
    })),
  })
})

// audit_logs.id is bigserial. The detail URL param is the integer id as a
// string; we coerce to number and reject anything else with 400.
const idParamSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/, 'audit log id must be a positive integer')
    .transform((s) => parseInt(s, 10)),
})

/**
 * GET /api/admin/audit/verify-chain?partition=audit_logs_2026_05
 *
 * Walks the named partition and reports any rows whose stored `chain_hash`
 * disagrees with the recomputed hash. An intact partition returns
 * `{ mismatches: [], partition }` with HTTP 200; a tampered partition lists
 * each broken row so a human can investigate.
 *
 * The WORKERS_ENABLED audit-chain worker invokes the same verifier for the
 * current and prior partitions. This endpoint remains the bounded manual
 * investigation path.
 */
const verifyChainQuerySchema = z.object({
  partition: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'invalid partition name'),
})

adminAuditRouter.get('/verify-chain', async (req: Request, res: Response) => {
  const parsed = verifyChainQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PARAMS', details: parsed.error.flatten() })
    return
  }

  const { partition } = parsed.data

  // verify_audit_chain() is SECURITY DEFINER (0002) so it walks the partition
  // with the definer's BYPASSRLS — the wrapper here is for GUC consistency and
  // the bare-db CI gate, not row visibility.
  const rows = await withTenantTx(
    { tenantId: req.tenant.id, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) =>
      tx.execute<{
        id: string
        ts: string
        stored_hash: string | null
        expected_hash: string | null
        match: boolean
      }>(sql`SELECT id::text AS id,
              ts::text AS ts,
              encode(stored_hash, 'hex') AS stored_hash,
              encode(expected_hash, 'hex') AS expected_hash,
              match
         FROM verify_audit_chain(${partition})`),
  )

  res.json({
    partition,
    mismatches: rows.map((r) => ({
      id: r.id,
      timestamp: r.ts,
      storedHash: r.stored_hash,
      expectedHash: r.expected_hash,
    })),
  })
})

/** GET /api/admin/audit/:id — single audit log entry with user + branch details */
adminAuditRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = idParamSchema.safeParse(req.params)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_ID' })
    return
  }
  const { id } = parsed.data

  const rows = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) =>
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          branchDisplayId: branches.displayId,
          userDisplayId: users.displayId,
          sessionId: auditLogs.sessionId,
          correlationId: auditLogs.correlationId,
          ipAddress: auditLogs.ipAddress,
          userAgent: auditLogs.userAgent,
          changes: auditLogs.changes,
          metadata: auditLogs.metadata,
          timestamp: auditLogs.timestamp,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
          userRole: userPrimaryRoleSql(users.id),
          branchName: branches.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .leftJoin(branches, eq(auditLogs.branchId, branches.id))
        .where(and(eq(auditLogs.id, id), eq(auditLogs.tenantId, tenantId)))
        .limit(1),
  )

  const row = rows[0]
  if (!row) {
    res.status(404).json({ error: 'NOT_FOUND' })
    return
  }

  res.json({
    id: String(row.id),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    sessionId: row.sessionId !== null ? String(row.sessionId) : null,
    correlationId: row.correlationId,
    timestamp: row.timestamp.toISOString(),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    changes: redactChanges(row.changes),
    metadata: redactChanges(row.metadata),
    user: row.userDisplayId
      ? {
          id: row.userDisplayId,
          firstName: row.userFirstName,
          lastName: row.userLastName,
          email: row.userEmail,
          role: row.userRole,
        }
      : null,
    branch: row.branchDisplayId
      ? {
          id: row.branchDisplayId,
          name: row.branchName,
        }
      : null,
  })
})

/** Generate a human-readable description from audit log entry */
function describeAuditEntry(entry: {
  action: string
  entityType: string
  entityId: string | null
  changes: unknown
  userFirstName: string | null
  userLastName: string | null
}): string {
  const actionLabels: Record<string, string> = {
    CREATE: 'Created',
    UPDATE: 'Updated',
    DELETE: 'Deleted',
    LOGIN: 'Logged in',
    LOGOUT: 'Logged out',
    TRANSACTION_MODIFY: 'Modified transaction',
    SCHEDULE_CHANGE: 'Changed schedule',
    CROSS_BRANCH_ACCESS: 'Cross-branch access',
  }

  const label = actionLabels[entry.action] ?? entry.action
  if (entry.action === 'LOGIN' || entry.action === 'LOGOUT') return label
  // entity_id is the audited row's display_id (or null for tables without one).
  return `${label} ${entry.entityType}${entry.entityId ? ` ${entry.entityId}` : ''}`
}
