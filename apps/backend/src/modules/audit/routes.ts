/**
 * Audit module — read-only surface over audit_logs, plus fire-and-forget
 * print/export event endpoints.
 *
 * Two-tier IDs (W3.c.3, 2026-05-19):
 *   - `audit_logs.id` is bigserial-only; the row has NO display_id. We coerce
 *     the bigint id to string when surfacing for stable client-side keys.
 *   - `audit_logs.entity_id` is text — stores the parent row's display_id
 *     (e.g. `PAT_K9MX3VQ2`). The audit trigger denormalizes `entity_display_id`
 *     into the same value; we surface `entityDisplayId` directly.
 *   - `audit_logs.user_id` / `branch_id` are bigint internals; we project the
 *     bigint plus a joined `userName` for the dashboard timeline.
 */
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { requireRole } from '../../shared/middleware/requireRole.js'
import { and, desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { auditLogs, users } from '../../shared/db/schema.js'
import { auditLogStandalone } from '../../shared/utils/auditLog.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

export const auditRouter: RouterType = Router()

const querySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
})

type AuditSeverity = 'warning' | 'info'

const WARNING_ACTIONS = new Set([
  'CROSS_BRANCH_ACCESS',
  'TRANSACTION_MODIFY',
  'SCHEDULE_CHANGE',
  'DELETE',
  'LOGIN_FAILED',
  'BREAK_GLASS',
  'PERMISSION_CHANGE',
  'CONFIG_CHANGE',
])

function mapSeverity(action: string): AuditSeverity {
  return WARNING_ACTIONS.has(action) ? 'warning' : 'info'
}

type MappedEntry = {
  actor: string
  action: string
  entityType: string
  entityId: string | null
  /** Legacy human-readable sentence; kept for backward compat. */
  message: string
}

function mapMessage(entry: {
  action: string
  entityType: string
  entityDisplayId: string | null
  userName: string
}): MappedEntry {
  const actionLabels: Record<string, string> = {
    CREATE: 'created',
    UPDATE: 'updated',
    DELETE: 'deleted',
    LOGIN: 'logged in',
    LOGOUT: 'logged out',
    LOGIN_FAILED: 'failed login',
    BREAK_GLASS: 'break-glass accessed',
    TRANSACTION_MODIFY: 'modified transaction',
    SCHEDULE_CHANGE: 'changed schedule for',
    CROSS_BRANCH_ACCESS: 'accessed cross-branch',
    PERMISSION_CHANGE: 'changed permissions on',
    CONFIG_CHANGE: 'changed config for',
    EXPORT: 'exported',
    PRINT: 'printed',
    AUDIT_ACCESS: 'accessed audit log for',
  }
  const verb = actionLabels[entry.action] ?? entry.action.toLowerCase()

  let message: string
  if (entry.action === 'LOGIN' || entry.action === 'LOGOUT' || entry.action === 'LOGIN_FAILED') {
    message = `${entry.userName} ${verb}`
  } else {
    // entity_display_id is the parent row's display_id (e.g. `PAT_K9MX3VQ2`) —
    // safe to surface in full since it is already the human-facing handle.
    const entity = entry.entityDisplayId
      ? `${entry.entityType} ${entry.entityDisplayId}`
      : entry.entityType
    message = `${entry.userName} ${verb} ${entity}`
  }

  return {
    actor: entry.userName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityDisplayId,
    message,
  }
}

/**
 * Shared body schema for print-event and export-event.
 *
 * - `entityType`: audited table name (e.g. `'transactions'`, `'lab_orders'`)
 * - `entityId`:   audited row's display_id (e.g. `'TXN_…'`, `'LBO_…'`)
 * - `documentType`: human-readable document kind
 *                 (e.g. `'receipt'`, `'lab_result'`, `'day_summary_csv'`)
 */
const eventBodySchema = z.object({
  entityType: z.string().min(1).max(80),
  entityId: z.string().min(1).max(80),
  documentType: z.string().min(1).max(80),
})

/**
 * POST /api/audit/print-event
 *
 * Frontend calls this when a user completes a print action (receipt, lab
 * result, etc.). Records an `audit_logs` row with `action = 'PRINT'` so
 * security reviews can answer "who printed this document?".
 *
 * Platform admins are refused (403) — these endpoints are tenant-scoped.
 * No FK verification of `entityId` — stored verbatim (audit_logs.entity_id
 * is a text column with no FK constraint; defense-in-depth via RLS).
 */
auditRouter.post('/print-event', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user

  if (user.isPlatformAdmin) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
    return
  }

  const parsed = eventBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'INVALID_BODY', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const { entityType, entityId, documentType } = parsed.data

  await auditLogStandalone({
    tenantId: req.tenant.id,
    userId: user.id,
    branchId: user.branchId,
    action: 'PRINT',
    entityType,
    entityId,
    metadata: { documentType },
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  })

  res.status(201).json({ ok: true })
})

/**
 * POST /api/audit/export-event
 *
 * Server-side export handlers (or the frontend) call this when an export
 * completes (CSV day summary, etc.). Records an `audit_logs` row with
 * `action = 'EXPORT'`.
 *
 * Platform admins are refused (403) — these endpoints are tenant-scoped.
 */
auditRouter.post('/export-event', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user

  if (user.isPlatformAdmin) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
    return
  }

  const parsed = eventBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'INVALID_BODY', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    return
  }

  const { entityType, entityId, documentType } = parsed.data

  await auditLogStandalone({
    tenantId: req.tenant.id,
    userId: user.id,
    branchId: user.branchId,
    action: 'EXPORT',
    entityType,
    entityId,
    metadata: { documentType },
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  })

  res.status(201).json({ ok: true })
})

/**
 * GET /api/audit/recent?hours=24
 *
 * Returns a bounded slice of recent audit log entries visible to the
 * authenticated user's tenant. Accessible to any authenticated role
 * Admin-only, gated on the route rather than the mount. The router itself is
 * open to every clinical role because print-event and export-event must record
 * the actor who produced a document, and that is usually the Branch account.
 * READING the trail is a different privilege from writing your own entry to it:
 * the audit log names who looked at which patient, so it stays with the roles
 * that already see tenant-wide administration. An earlier version of this
 * comment claimed the timeline renders "for all staff"; it never did, because
 * the mount 403'd everyone else, and the dashboard card is now hidden for
 * non-admins to match.
 *
 * Max 50 rows; ?hours capped at 168 (1 week).
 */
auditRouter.get(
  '/recent',
  requireRole('TenantAdmin', 'BranchAdmin'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_PARAMS', details: parsed.error.flatten() })
      return
    }

    const { hours } = parsed.data
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)

    const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, (tx) =>
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          entityDisplayId: auditLogs.entityDisplayId,
          timestamp: auditLogs.timestamp,
          userFirstName: users.firstName,
          userLastName: users.lastName,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(and(eq(auditLogs.tenantId, tenantId), gte(auditLogs.timestamp, since)))
        .orderBy(desc(auditLogs.timestamp))
        .limit(50),
    )

    res.json(
      rows.map((r) => {
        const userName =
          r.userFirstName && r.userLastName ? `${r.userFirstName} ${r.userLastName}` : 'System'

        const mapped = mapMessage({
          action: r.action,
          entityType: r.entityType,
          entityDisplayId: r.entityDisplayId ?? r.entityId,
          userName,
        })

        return {
          // bigint PK coerced to string for stable JSON key shape across browsers.
          id: String(r.id),
          timestamp: r.timestamp.toISOString(),
          action: r.action,
          entityType: r.entityType,
          // `entityId` text column already stores the parent's display_id; surface as-is.
          entityId: r.entityId,
          entityDisplayId: r.entityDisplayId,
          severity: mapSeverity(r.action),
          // Legacy sentence-form message (backward compat)
          message: mapped.message,
          // Structured fields added alongside legacy message
          actor: mapped.actor,
          structuredAction: mapped.action,
          structuredEntityType: mapped.entityType,
          structuredEntityId: mapped.entityId,
        }
      }),
    )
  },
)
