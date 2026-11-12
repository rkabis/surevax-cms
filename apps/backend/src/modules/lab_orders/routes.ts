import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  listLabOrders,
  getLabOrder,
  createLabOrder,
  acknowledgeCriticalValue,
  markLabSent,
  submitLabResult,
} from './db.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  labOrderIdSchema,
  createLabOrderBody,
  submitLabResultBody,
  type LabOrdersListResponse,
  type LabOrdersDetailResponse,
  type LabOrdersCreateResponse,
  type LabOrdersMarkSentResponse,
  type LabOrdersResultResponse,
  type LabOrdersAcknowledgeCriticalResponse,
} from './contract.js'

export const labOrdersRouter: RouterType = Router()

// Allow-list of sortable column keys for GET /api/lab-orders.
const LAB_ORDER_SORTABLE_COLUMNS = ['created_at', 'status', 'sent_at'] as const
type LabOrderSortCol = (typeof LAB_ORDER_SORTABLE_COLUMNS)[number]

/** GET /api/lab-orders — list for current tenant, with optional sort */
labOrdersRouter.get('/', async (req: Request, res: Response) => {
  const sortRaw = typeof req.query['sort'] === 'string' ? req.query['sort'] : undefined
  const sort = LAB_ORDER_SORTABLE_COLUMNS.includes(sortRaw as LabOrderSortCol)
    ? (sortRaw as LabOrderSortCol)
    : undefined
  const orderRaw = typeof req.query['order'] === 'string' ? req.query['order'] : undefined
  const order = orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : undefined

  const data = await listLabOrders(req.tenant.id, { sort, order })
  res.json(wire(data) satisfies LabOrdersListResponse)
})

/** GET /api/lab-orders/:id — detail with joined service/patient/lab labels */
labOrdersRouter.get('/:id', async (req: Request, res: Response) => {
  const parsed = labOrderIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid lab order id', code: 'INVALID_ID' })
    return
  }
  const row = await getLabOrder(req.tenant.id, parsed.data)
  if (!row) {
    res.status(404).json({ error: 'Lab order not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(row) satisfies LabOrdersDetailResponse)
})

/** POST /api/lab-orders — create a new lab order (Pending status) */
labOrdersRouter.post('/', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user

  const bodyParsed = createLabOrderBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: bodyParsed.error.issues[0]?.message ?? 'Invalid body',
      code: 'VALIDATION_ERROR',
    })
    return
  }

  const row = await createLabOrder({
    tenantId: req.tenant.id,
    clinicalOrderDisplayId: bodyParsed.data.clinicalOrderId,
    laboratoryDisplayId: bodyParsed.data.laboratoryId ?? null,
    externalOrderId: bodyParsed.data.externalOrderId ?? null,
    notes: bodyParsed.data.notes ?? null,
    userId: user?.id ?? null,
    branchId: user?.branchId ?? null,
  })

  if (!row) {
    res.status(404).json({ error: 'Clinical order or laboratory not found', code: 'NOT_FOUND' })
    return
  }
  res.status(201).json(wire(row) satisfies LabOrdersCreateResponse)
})

/** POST /api/lab-orders/:id/mark-sent — transition Pending → Sent */
labOrdersRouter.post('/:id/mark-sent', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const parsed = labOrderIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid lab order id', code: 'INVALID_ID' })
    return
  }

  const result = await markLabSent(req.tenant.id, parsed.data, user?.id ?? null)

  switch (result.type) {
    case 'not_found':
      res.status(404).json({ error: 'Lab order not found', code: 'NOT_FOUND' })
      return
    case 'invalid_state':
      res.status(409).json({ error: 'Lab order is not in Pending state', code: 'INVALID_STATE' })
      return
    case 'success':
      res.json(wire(result.row) satisfies LabOrdersMarkSentResponse)
      return
  }
})

/** POST /api/lab-orders/:id/result — submit result, transition Sent → ResultReceived */
labOrdersRouter.post('/:id/result', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const parsed = labOrderIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid lab order id', code: 'INVALID_ID' })
    return
  }

  const bodyParsed = submitLabResultBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: bodyParsed.error.issues[0]?.message ?? 'Invalid body',
      code: 'VALIDATION_ERROR',
    })
    return
  }

  const result = await submitLabResult(
    req.tenant.id,
    parsed.data,
    user?.id ?? null,
    bodyParsed.data,
  )

  switch (result.type) {
    case 'not_found':
      res.status(404).json({ error: 'Lab order not found', code: 'NOT_FOUND' })
      return
    case 'invalid_state':
      res.status(409).json({ error: 'Lab order is not in Sent state', code: 'INVALID_STATE' })
      return
    case 'success':
      res.json(wire(result.row) satisfies LabOrdersResultResponse)
      return
  }
})

/** POST /api/lab-orders/:id/acknowledge-critical — acknowledge a critical lab value */
labOrdersRouter.post('/:id/acknowledge-critical', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const parsed = labOrderIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid lab order id', code: 'INVALID_ID' })
    return
  }

  const result = await acknowledgeCriticalValue(req.tenant.id, parsed.data, user?.id ?? null)

  switch (result.type) {
    case 'not_found':
      res.status(404).json({ error: 'Lab order not found', code: 'NOT_FOUND' })
      return
    case 'not_critical':
      res
        .status(409)
        .json({ error: 'Lab order does not have a critical value', code: 'NOT_CRITICAL' })
      return
    case 'already_acknowledged':
      res
        .status(409)
        .json({ error: 'Critical value already acknowledged', code: 'ALREADY_ACKNOWLEDGED' })
      return
    case 'success':
      res.json(wire(result.row) satisfies LabOrdersAcknowledgeCriticalResponse)
      return
  }
})
