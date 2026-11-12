/**
 * Adverse Events module — HTTP layer.
 *
 * Two-tier IDs (W3.c.3, 2026-05-19):
 *   - URL params + body ids use display_id strings (`AVE_`, `PAT_`, `ENC_`,
 *     `ORD_`). Inline Zod validates the prefix.
 *   - Auth user id is bigint (`number`) per shared/middleware/auth.ts.
 */
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { validate } from '../../shared/middleware/validate.js'
import { isApiError } from '../../shared/lib/apiError.js'
import * as db from './db.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  aveIdSchema,
  listQuerySchema,
  createBodySchema,
  updateBodySchema,
  type AdverseEventsListResponse,
  type AdverseEventsDetailResponse,
  type AdverseEventsCreateResponse,
  type AdverseEventsUpdateResponse,
  type AdverseEventsRemoveResponse,
} from './contract.js'

export const adverseEventsRouter: RouterType = Router()

type AuthUser = {
  id: number | null
  displayId: string
  email: string
  role: string
  tenantId: string
  branchId: number | null
}

/** GET /api/adverse-events */
adverseEventsRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'INVALID_INPUT',
      details: parsed.error.flatten().fieldErrors,
    })
    return
  }
  const { patientId, severity, limit } = parsed.data
  const events = await db.listAdverseEvents(tenantId, { patientId, severity, limit })
  res.json(events satisfies AdverseEventsListResponse)
})

/** GET /api/adverse-events/:id */
adverseEventsRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const idParsed = aveIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid adverse event id', code: 'INVALID_ID' })
    return
  }
  const event = await db.getAdverseEvent(tenantId, idParsed.data)
  if (!event) {
    res.status(404).json({ error: 'Adverse event not found', code: 'NOT_FOUND' })
    return
  }
  res.json(event satisfies AdverseEventsDetailResponse)
})

/** POST /api/adverse-events */
adverseEventsRouter.post('/', validate(createBodySchema), async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  if (user.id == null) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
    return
  }
  const tenantId = req.tenant.id

  try {
    const created = await db.createAdverseEvent(tenantId, user.id, user.branchId, req.body)
    if (!created) {
      res
        .status(500)
        .json({ error: 'Adverse event creation returned no row', code: 'INTERNAL_ERROR' })
      return
    }
    res.status(201).json(created satisfies AdverseEventsCreateResponse)
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
})

/** PATCH /api/adverse-events/:id */
adverseEventsRouter.patch(
  '/:id',
  validate(updateBodySchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    if (user.id == null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const tenantId = req.tenant.id
    const idParsed = aveIdSchema.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid adverse event id', code: 'INVALID_ID' })
      return
    }

    const updated = await db.updateAdverseEvent(
      tenantId,
      user.id,
      user.branchId,
      idParsed.data,
      req.body,
    )
    if (!updated) {
      res.status(404).json({ error: 'Adverse event not found', code: 'NOT_FOUND' })
      return
    }
    res.json(updated satisfies AdverseEventsUpdateResponse)
  },
)

/** DELETE /api/adverse-events/:id — soft delete */
adverseEventsRouter.delete('/:id', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  if (user.id == null) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
    return
  }
  const tenantId = req.tenant.id
  const idParsed = aveIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid adverse event id', code: 'INVALID_ID' })
    return
  }

  const result = await db.softDeleteAdverseEvent(tenantId, user.id, user.branchId, idParsed.data)
  if (!result) {
    res.status(404).json({ error: 'Adverse event not found', code: 'NOT_FOUND' })
    return
  }
  res.json(result satisfies AdverseEventsRemoveResponse)
})
