import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { requireRole } from '../../shared/middleware/requireRole.js'
import { isApiError } from '../../shared/lib/apiError.js'
import {
  listRecalls,
  getRecall,
  createRecall,
  updateRecall,
  softDeleteRecall,
  getRecallMatchesForLot,
  fanOutRecallNotifications,
} from './db.js'
import { logger } from '../../shared/utils/logger.js'

export const productRecallsRouter: RouterType = Router()

// ── Inline Zod schemas ───────────────────────────────────────────────────────

const recallSeverityEnum = z.enum(['Class1', 'Class2', 'Class3'])

const listQuerySchema = z.object({
  productId: prefixedDisplayIdSchema('PRD').optional(),
  severity: recallSeverityEnum.optional(),
  active: z
    .string()
    .optional()
    .transform((v) => {
      if (v === 'true') return true
      if (v === 'false') return false
      return undefined
    }),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const recallIdParam = prefixedDisplayIdSchema('RCL')
const lotIdParam = prefixedDisplayIdSchema('LOT')

const createBodySchema = z.object({
  productId: prefixedDisplayIdSchema('PRD').optional().nullable(),
  manufacturer: z.string().max(200).optional().nullable(),
  affectedLotsPattern: z.string().max(200).optional().nullable(),
  recallReason: z.string().min(1).max(2000),
  recallSeverity: recallSeverityEnum,
  issuedAt: z.string().datetime({ message: 'Issued at must be an ISO 8601 timestamp' }),
  patientNotificationRequired: z.boolean().optional(),
})

const updateBodySchema = z
  .object({
    recallReason: z.string().min(1).max(2000).optional(),
    recallSeverity: recallSeverityEnum.optional(),
    manufacturer: z.string().max(200).optional().nullable(),
    affectedLotsPattern: z.string().max(200).optional().nullable(),
    resolvedAt: z.string().datetime().optional().nullable(),
    patientNotificationRequired: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' })

// ── GET /api/product-recalls — list ─────────────────────────────────────────

productRecallsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() })
    return
  }

  const tenantId = req.tenant.id
  const { productId, severity, active, limit } = parsed.data

  const data = await listRecalls({
    tenantId,
    productDisplayId: productId,
    severity,
    active,
    limit,
  })

  res.json(data)
})

// ── GET /api/product-recalls/lots/:lotId/matches — lot lookup ────────────────
// NOTE: mounted BEFORE /:id to prevent "lots" being interpreted as an id param

productRecallsRouter.get('/lots/:lotId/matches', async (req: Request, res: Response) => {
  const lotParsed = lotIdParam.safeParse(req.params['lotId'])
  if (!lotParsed.success) {
    res.status(400).json({ error: 'Invalid lot id', details: lotParsed.error.flatten() })
    return
  }

  const tenantId = req.tenant.id
  const { lot, matches } = await getRecallMatchesForLot(tenantId, lotParsed.data)

  if (!lot) {
    res.status(404).json({ error: 'Lot not found' })
    return
  }

  res.json({ matches })
})

// ── GET /api/product-recalls/:id — detail ───────────────────────────────────

productRecallsRouter.get('/:id', async (req: Request, res: Response) => {
  const parsed = recallIdParam.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid id', details: parsed.error.flatten() })
    return
  }

  const tenantId = req.tenant.id
  const recall = await getRecall(tenantId, parsed.data)

  if (!recall) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({ data: recall })
})

// ── POST /api/product-recalls — create (admin only) ─────────────────────────

productRecallsRouter.post(
  '/',
  requireRole('TenantAdmin', 'BranchAdmin'),
  async (req: Request, res: Response) => {
    const parsed = createBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() })
      return
    }

    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    try {
      const newDisplayId = await createRecall({
        tenantId,
        userId,
        productDisplayId: parsed.data.productId,
        manufacturer: parsed.data.manufacturer,
        affectedLotsPattern: parsed.data.affectedLotsPattern,
        recallReason: parsed.data.recallReason,
        recallSeverity: parsed.data.recallSeverity,
        issuedAt: new Date(parsed.data.issuedAt),
        patientNotificationRequired: parsed.data.patientNotificationRequired,
      })

      // Notify the patients who received a dose from an affected lot.
      //
      // This call is the whole point of the recall record, and until now it was
      // missing: fanOutRecallNotifications was fully built (idempotent,
      // consent-gated, templated) and called from nowhere, so raising a recall
      // notified no one. `patient_notification_required` (NOT NULL DEFAULT
      // true) is the intended switch and the helper re-checks it itself, so
      // there is no separate publish step to wait for.
      //
      // It opens its own transaction, so a notification failure cannot roll
      // back the recall record: the recall is the safety-critical write and
      // must survive regardless. A failure is logged and surfaced in the
      // response count rather than thrown, so the operator sees that the
      // recall was saved but the fan-out needs attention.
      let notificationsQueued: number | null = null
      try {
        notificationsQueued = await fanOutRecallNotifications(tenantId, newDisplayId)
      } catch (fanOutErr) {
        logger.error(
          { err: fanOutErr, recallDisplayId: newDisplayId, tenantId },
          '[product_recalls] recall saved but patient notification fan-out failed',
        )
      }

      const recall = await getRecall(tenantId, newDisplayId)
      res.status(201).json({ data: recall, notificationsQueued })
    } catch (err) {
      // db.ts throws Object.assign(new Error(...), { statusCode, code }), the
      // same shape the shared isApiError() duck-type check already covers, so
      // reuse it instead of re-casting inline. Same status codes as before.
      if (isApiError(err)) {
        res.status(err.statusCode).json({ error: err.message, code: err.code })
        return
      }
      throw err
    }
  },
)

// ── PATCH /api/product-recalls/:id — update (admin only) ────────────────────

productRecallsRouter.patch(
  '/:id',
  requireRole('TenantAdmin', 'BranchAdmin'),
  async (req: Request, res: Response) => {
    const paramsParsed = recallIdParam.safeParse(req.params['id'])
    if (!paramsParsed.success) {
      res.status(400).json({ error: 'Invalid id', details: paramsParsed.error.flatten() })
      return
    }

    const bodyParsed = updateBodySchema.safeParse(req.body)
    if (!bodyParsed.success) {
      res.status(400).json({ error: 'Invalid body', details: bodyParsed.error.flatten() })
      return
    }

    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    const recallDisplayId = paramsParsed.data
    const body = bodyParsed.data

    const found = await updateRecall(tenantId, userId, recallDisplayId, {
      recallReason: body.recallReason,
      recallSeverity: body.recallSeverity,
      manufacturer: body.manufacturer,
      affectedLotsPattern: body.affectedLotsPattern,
      resolvedAt:
        body.resolvedAt !== undefined
          ? body.resolvedAt
            ? new Date(body.resolvedAt)
            : null
          : undefined,
      patientNotificationRequired: body.patientNotificationRequired,
    })

    if (!found) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const updated = await getRecall(tenantId, recallDisplayId)
    res.json({ data: updated })
  },
)

// ── DELETE /api/product-recalls/:id — soft delete (admin only) ──────────────

productRecallsRouter.delete(
  '/:id',
  requireRole('TenantAdmin', 'BranchAdmin'),
  async (req: Request, res: Response) => {
    const parsed = recallIdParam.safeParse(req.params['id'])
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid id', details: parsed.error.flatten() })
      return
    }

    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    const found = await softDeleteRecall(tenantId, userId, parsed.data)

    if (!found) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    res.status(204).send()
  },
)
