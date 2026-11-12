import { Router, type Router as RouterType, type Request, type Response } from 'express'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { listNotifications, getNotification, resendNotification, dryRunNotification } from './db.js'
import { logger } from '../../shared/utils/logger.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  listQuerySchema,
  idParamsSchema,
  dryRunBodySchema,
  type NotificationsListResponse,
  type NotificationsDetailResponse,
  type NotificationsResendResponse,
  type NotificationsDryRunResponse,
} from './contract.js'

export const notificationsRouter: RouterType = Router()

// ── GET /api/admin/notifications — list ─────────────────────────────────────

notificationsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  const { status, patientId, channel, cursor, limit } = parsed.data

  try {
    const result = await listNotifications({
      tenantId,
      userId: user.id,
      status,
      patientId,
      channel,
      cursor,
      limit,
    })
    res.set('X-Total-Count', String(result.totalCount))
    if (result.nextCursor) res.set('X-Next-Cursor', result.nextCursor)
    res.json(result.rows satisfies NotificationsListResponse)
  } catch (err) {
    // Previously swallowed the underlying error — the route returned a
    // bare 500 with no signal, which made the empty-list bug invisible
    // in production logs. Log structured detail so operators can trace.
    logger.error(
      {
        err,
        tenantId,
        userId: user.id,
        status,
        channel,
        patientId,
      },
      'admin/notifications: listNotifications failed',
    )
    res.status(500).json({ error: 'Failed to list notifications' })
  }
})

// ── GET /api/admin/notifications/:id — detail ────────────────────────────────

notificationsRouter.get('/:id', async (req: Request, res: Response) => {
  const parsed = idParamsSchema.safeParse(req.params)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid id', details: parsed.error.flatten() })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  try {
    const row = await getNotification(tenantId, user.id, parsed.data.id)
    if (!row) {
      res.status(404).json({ error: 'Notification not found' })
      return
    }
    res.json(row satisfies NotificationsDetailResponse)
  } catch {
    res.status(500).json({ error: 'Failed to get notification' })
  }
})

// ── POST /api/admin/notifications/:id/resend ─────────────────────────────────

notificationsRouter.post('/:id/resend', async (req: Request, res: Response) => {
  const parsed = idParamsSchema.safeParse(req.params)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid id', details: parsed.error.flatten() })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  try {
    const result = await resendNotification(tenantId, user.id, parsed.data.id)

    if (!result) {
      res.status(404).json({ error: 'Notification not found' })
      return
    }

    if (result.newId === '__CONFLICT__') {
      res.status(409).json({ error: 'Notification is already Queued — cannot resend' })
      return
    }

    res.status(201).json({ id: result.newId } satisfies NotificationsResendResponse)
  } catch {
    res.status(500).json({ error: 'Failed to resend notification' })
  }
})

// ── POST /api/admin/notifications/dry-run ────────────────────────────────────

notificationsRouter.post('/dry-run', async (req: Request, res: Response) => {
  const parsed = dryRunBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  const { patientId, templateCode, channel, body } = parsed.data

  try {
    const row = await dryRunNotification({
      tenantId,
      userId: user.id,
      patientId,
      templateCode,
      channel,
      body,
    })
    res.status(201).json(row satisfies NotificationsDryRunResponse)
  } catch {
    res.status(500).json({ error: 'Failed to create dry-run notification' })
  }
})
