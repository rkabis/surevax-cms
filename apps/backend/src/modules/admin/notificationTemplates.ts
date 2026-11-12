import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq, desc, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../shared/db/index.js'
import { notificationTemplates } from '../../shared/db/schema.js'
import { validate } from '../../shared/middleware/validate.js'
import { displayId, prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'

export const adminNotificationTemplatesRouter: RouterType = Router()

type AuthUser = {
  id: number | null
  email: string
  role: string
  tenantId: string | null
  branchId: number | null
}

// ── ID schema ─────────────────────────────────────────────────────────────────

const ntpDisplayIdSchema = prefixedDisplayIdSchema('NTP')

// ── Zod schemas ───────────────────────────────────────────────────────────────

// NOTE: `name` is NOT a column on notification_templates (only `code` is the
// human-readable identifier). Reject `name` in input schemas to fail fast
// instead of silently dropping it on insert / erroring on update.
const createSchema = z.object({
  code: z.string().min(1).max(100),
  channel: z.enum(['SMS', 'Email', 'Push']),
  language: z.string().max(10).default('en'),
  subject: z.string().max(500).optional().nullable(),
  body: z.string().min(1).max(10_000),
  isActive: z.boolean().default(true),
})

const updateSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  channel: z.enum(['SMS', 'Email', 'Push']).optional(),
  language: z.string().max(10).optional(),
  subject: z.string().max(500).optional().nullable(),
  body: z.string().min(1).max(10_000).optional(),
  isActive: z.boolean().optional(),
})

const listQuerySchema = z.object({
  channel: z.enum(['SMS', 'Email', 'Push']).optional(),
  code: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const idParamsSchema = z.object({ id: ntpDisplayIdSchema })

// ── Serializer: hide internal bigint id, surface display_id as public `id` ────

type NotificationTemplateRow = typeof notificationTemplates.$inferSelect

function serializeTemplate(row: NotificationTemplateRow) {
  return {
    id: row.displayId,
    tenantId: row.tenantId,
    code: row.code,
    channel: row.channel,
    language: row.language,
    subject: row.subject,
    body: row.body,
    isActive: row.isActive,
    rowVersion: row.rowVersion,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    createdById: row.createdById,
  }
}

// ── GET /api/admin/notification-templates ─────────────────────────────────────

adminNotificationTemplatesRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() })
    return
  }

  const tenantId = req.tenant.id
  const { channel, code, isActive: activeFilter, limit } = parsed.data

  const conditions = [
    eq(notificationTemplates.tenantId, tenantId),
    isNull(notificationTemplates.deletedAt),
  ]

  if (channel) conditions.push(eq(notificationTemplates.channel, channel))
  if (code) conditions.push(eq(notificationTemplates.code, code))
  if (activeFilter !== undefined) conditions.push(eq(notificationTemplates.isActive, activeFilter))

  const rows = await db
    .select()
    .from(notificationTemplates)
    .where(and(...conditions))
    .orderBy(desc(notificationTemplates.code))
    .limit(limit ?? 100)

  // Frontend hooks expect a `{ data: [...] }` envelope (see notificationsApi.ts).
  res.json({ data: rows.map(serializeTemplate) })
})

// ── POST /api/admin/notification-templates ────────────────────────────────────

adminNotificationTemplatesRouter.post(
  '/',
  validate(createSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    const branchId = req.tenant.branchId
    if (userId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const body = req.body as z.infer<typeof createSchema>

    const ntpDisplayId = displayId('NTP')

    const inserted = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`)
      await tx.execute(sql`select set_config('app.current_user_id', ${String(userId)}, true)`)
      await tx.execute(
        sql`select set_config('app.current_branch_id', ${branchId === null ? '' : String(branchId)}, true)`,
      )

      const [row] = await tx
        .insert(notificationTemplates)
        .values({
          displayId: ntpDisplayId,
          tenantId,
          code: body.code,
          channel: body.channel,
          language: body.language,
          subject: body.subject ?? null,
          body: body.body,
          isActive: body.isActive,
          createdById: userId,
        })
        .returning()

      return row!
    })

    // Touch `user` to keep the import side-effect free for future auth needs.
    void user

    res.status(201).json(serializeTemplate(inserted))
  },
)

// ── GET /api/admin/notification-templates/:id ─────────────────────────────────

adminNotificationTemplatesRouter.get(
  '/:id',
  validate(idParamsSchema, 'params'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const { id } = req.params as { id: string }

    const [row] = await db
      .select()
      .from(notificationTemplates)
      .where(
        and(eq(notificationTemplates.displayId, id), eq(notificationTemplates.tenantId, tenantId)),
      )
      .limit(1)

    if (!row) {
      res.status(404).json({ error: 'Template not found' })
      return
    }

    res.json(serializeTemplate(row))
  },
)

// ── PATCH /api/admin/notification-templates/:id ───────────────────────────────

adminNotificationTemplatesRouter.patch(
  '/:id',
  validate(idParamsSchema, 'params'),
  validate(updateSchema),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    const branchId = req.tenant.branchId
    if (userId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const { id } = req.params as { id: string }
    const body = req.body as z.infer<typeof updateSchema>

    const updateData: Record<string, unknown> = {}
    if (body.code !== undefined) updateData['code'] = body.code
    if (body.channel !== undefined) updateData['channel'] = body.channel
    if (body.language !== undefined) updateData['language'] = body.language
    if (body.subject !== undefined) updateData['subject'] = body.subject
    if (body.body !== undefined) updateData['body'] = body.body
    if (body.isActive !== undefined) updateData['isActive'] = body.isActive

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'No fields to update' })
      return
    }

    let notFound = false
    let updatedRow: NotificationTemplateRow | undefined

    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`)
      await tx.execute(sql`select set_config('app.current_user_id', ${String(userId)}, true)`)
      await tx.execute(
        sql`select set_config('app.current_branch_id', ${branchId === null ? '' : String(branchId)}, true)`,
      )

      const existing = await tx
        .select({ id: notificationTemplates.id })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.displayId, id),
            eq(notificationTemplates.tenantId, tenantId),
          ),
        )
        .limit(1)

      if (existing.length === 0) {
        notFound = true
        return
      }

      const [updated] = await tx
        .update(notificationTemplates)
        .set(updateData)
        .where(
          and(
            eq(notificationTemplates.displayId, id),
            eq(notificationTemplates.tenantId, tenantId),
          ),
        )
        .returning()

      updatedRow = updated
    })

    if (notFound) {
      res.status(404).json({ error: 'Template not found' })
      return
    }

    res.json(updatedRow ? serializeTemplate(updatedRow) : null)
  },
)

// ── DELETE /api/admin/notification-templates/:id ──────────────────────────────

adminNotificationTemplatesRouter.delete(
  '/:id',
  validate(idParamsSchema, 'params'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    const branchId = req.tenant.branchId
    if (userId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const { id } = req.params as { id: string }

    let notFound = false

    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_tenant_id', ${tenantId}, true)`)
      await tx.execute(sql`select set_config('app.current_user_id', ${String(userId)}, true)`)
      await tx.execute(
        sql`select set_config('app.current_branch_id', ${branchId === null ? '' : String(branchId)}, true)`,
      )

      const existing = await tx
        .select({ id: notificationTemplates.id })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.displayId, id),
            eq(notificationTemplates.tenantId, tenantId),
          ),
        )
        .limit(1)

      if (existing.length === 0) {
        notFound = true
        return
      }

      await tx
        .update(notificationTemplates)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(notificationTemplates.displayId, id),
            eq(notificationTemplates.tenantId, tenantId),
          ),
        )
    })

    if (notFound) {
      res.status(404).json({ error: 'Template not found' })
      return
    }

    res.json({ success: true })
  },
)
