import {
  Router,
  type Router as RouterType,
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import { idempotency } from '../../shared/middleware/idempotency.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { requireRole } from '../../shared/middleware/requireRole.js'
import {
  listScheduledOrders,
  listAdministeredOrders,
  getScheduledOrdersStats,
  getScheduledOrder,
  getOrderTimeline,
  getPrepayableDoses,
  getEligibleLots,
  previewRecompute,
  getTextDraft,
  canBranchAccessScheduledOrder,
  type ScheduledOrdersFilter,
} from './db.js'
import {
  recomputeOrder,
  administerOrder,
  recordObservationAction,
  rescheduleOrder,
} from './service.js'
import { clinicCalendarDate } from './dateMath.js'
import { sendLifecycleError as sendCanonicalLifecycleError } from '../../shared/lib/lifecycleError.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  orderIdSchema,
  administeredOnDateSchema,
  administerBody,
  observationActionBody,
  dosesQuerySchema,
  rescheduleBody,
  scheduledOrdersFilterSchema,
  type ScheduledOrdersListResponse,
  type ScheduledOrdersAdministeredResponse,
  type ScheduledOrdersDetailResponse,
  type ScheduledOrdersTimelineResponse,
  type ScheduledOrdersDosesResponse,
  type ScheduledOrdersEligibleLotsResponse,
  type ScheduledOrdersRecomputePreviewResponse,
  type ScheduledOrdersRecomputeResponse,
  type ScheduledOrdersAdministerResponse,
  type ScheduledOrdersObservationActionResponse,
  type ScheduledOrdersRescheduleResponse,
  type ScheduledOrdersTextDraftResponse,
} from './contract.js'

export const scheduledOrdersRouter: RouterType = Router()

const VALID_FILTERS = new Set<string>(scheduledOrdersFilterSchema.options)

// Delegates to the canonical shared/lib/lifecycleError.ts translator (fixes
// this module's local copy silently dropping `err.details`), then handles
// this module's own USER_CONTEXT_REQUIRED sentinel, a plain Error thrown by
// service.ts, not a LifecycleError. Returns true if handled.
function sendLifecycleError(res: Response, err: unknown): boolean {
  if (sendCanonicalLifecycleError(res, err)) return true
  if (err instanceof Error && err.message === 'USER_CONTEXT_REQUIRED') {
    res.status(403).json({ error: 'User context required', code: 'FORBIDDEN' })
    return true
  }
  return false
}

/**
 * Clinical branch roles are deliberately constrained to their own worklist.
 * Direct `/:id` routes used to bypass that worklist scope because their data
 * helpers perform tenant-wide lookups. Do not use a break-glass grant here:
 * that workflow is a separately audited, read-only patient-chart operation
 * and never authorizes scheduled-order administration or schedule changes.
 *
 * TenantAdmin behaviour remains tenant-wide, as established elsewhere in the
 * operational UI. Every other role allowed onto this router is branch-scoped.
 */
async function branchMayAccessOrder(req: Request, res: Response, id: string): Promise<boolean> {
  const user = (req as Request & { user: AuthUser }).user
  if (user.role === 'TenantAdmin') return true
  if (user.branchId === null) {
    res.status(403).json({ error: 'Branch context required', code: 'BRANCH_REQUIRED' })
    return false
  }

  const allowed = await canBranchAccessScheduledOrder({
    tenantId: req.tenant.id,
    branchId: user.branchId,
    id,
  })
  if (!allowed) {
    // Match the normal missing-order response; a Branch session must not be
    // able to enumerate another branch's clinical records by display ID.
    res.status(404).json({ error: 'Scheduled order not found', code: 'NOT_FOUND' })
    return false
  }
  return true
}

/** Run before idempotency replay on the administration write path. */
async function requireBranchOrderAccess(req: Request, res: Response, next: NextFunction) {
  const idParse = orderIdSchema.safeParse(req.params['id'])
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
    return
  }
  try {
    if (!(await branchMayAccessOrder(req, res, idParse.data))) return
    next()
  } catch (err) {
    next(err)
  }
}

/** GET /api/scheduled-orders — clinical orders awaiting administration */
scheduledOrdersRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined
  const patientId = typeof req.query['patientId'] === 'string' ? req.query['patientId'] : undefined
  const filterParam = typeof req.query['filter'] === 'string' ? req.query['filter'] : 'all'
  const filter = VALID_FILTERS.has(filterParam) ? (filterParam as ScheduledOrdersFilter) : 'all'
  // Branch scoping comes from the authenticated session ONLY, never a query
  // param: a client cannot ask to see another branch's queue.
  const user = (req as Request & { user: AuthUser }).user
  const branchId = user.branchId

  const [data, stats] = await Promise.all([
    listScheduledOrders({ tenantId, q, filter, patientId, branchId }),
    getScheduledOrdersStats(tenantId, branchId),
  ])

  res.json({ data, stats } satisfies ScheduledOrdersListResponse)
})

/** GET /api/scheduled-orders/administered?date=YYYY-MM-DD — branch-wide administered log for a day */
scheduledOrdersRouter.get('/administered', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const user = (req as Request & { user: AuthUser }).user
  const rawDate =
    typeof req.query['date'] === 'string'
      ? req.query['date']
      : clinicCalendarDate(new Date()).toISOString().slice(0, 10)

  const dateParse = administeredOnDateSchema.safeParse(rawDate)
  if (!dateParse.success) {
    res.status(400).json({ error: 'Invalid date param', code: 'INVALID_DATE' })
    return
  }

  const rows = await listAdministeredOrders({
    tenantId,
    branchId: user.branchId,
    date: dateParse.data,
  })

  res.json(rows satisfies ScheduledOrdersAdministeredResponse)
})

/** GET /api/scheduled-orders/:id — single clinical order with joins for detail drawer */
scheduledOrdersRouter.get('/:id', async (req: Request, res: Response) => {
  const idParse = orderIdSchema.safeParse(req.params['id'])
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
    return
  }
  const tenantId = req.tenant.id
  const id = idParse.data
  if (!(await branchMayAccessOrder(req, res, id))) return
  const order = await getScheduledOrder({ tenantId, id })
  if (!order) {
    res.status(404).json({ error: 'Scheduled order not found', code: 'NOT_FOUND' })
    return
  }
  res.json(order satisfies ScheduledOrdersDetailResponse)
})

/** GET /api/scheduled-orders/:id/timeline — sibling PSO orders as timeline entries */
scheduledOrdersRouter.get('/:id/timeline', async (req: Request, res: Response) => {
  const idParse = orderIdSchema.safeParse(req.params['id'])
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
    return
  }
  const tenantId = req.tenant.id
  const id = idParse.data
  if (!(await branchMayAccessOrder(req, res, id))) return
  const timeline = await getOrderTimeline({ tenantId, id })
  res.json(timeline satisfies ScheduledOrdersTimelineResponse)
})

/** GET /api/scheduled-orders/:id/doses — chain doses + billing status, for the prepay picker */
scheduledOrdersRouter.get('/:id/doses', async (req: Request, res: Response) => {
  const idParse = orderIdSchema.safeParse(req.params['id'])
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
    return
  }
  const queryParse = dosesQuerySchema.safeParse(req.query)
  if (!queryParse.success) {
    res.status(400).json({ error: 'Invalid payerId', code: 'VALIDATION_ERROR' })
    return
  }
  const tenantId = req.tenant.id
  const id = idParse.data
  const user = (req as Request & { user: AuthUser }).user
  if (!(await branchMayAccessOrder(req, res, id))) return
  const doses = await getPrepayableDoses({
    tenantId,
    id,
    payerId: queryParse.data.payerId,
    branchId: user.branchId,
  })
  res.json(doses satisfies ScheduledOrdersDosesResponse)
})

/**
 * GET /api/scheduled-orders/:id/text-draft: composed SMS reminder draft (QR
 * plus sms: URI plus plain body) for a nurse to send from THEIR OWN phone.
 * Manual only, see docs/nurse-testing-readiness.md R2. No provider, no
 * queue, no automation; that stays deferred.
 */
scheduledOrdersRouter.get('/:id/text-draft', async (req: Request, res: Response) => {
  const idParse = orderIdSchema.safeParse(req.params['id'])
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
    return
  }
  const tenantId = req.tenant.id
  const id = idParse.data
  const user = (req as Request & { user: AuthUser }).user
  if (!(await branchMayAccessOrder(req, res, id))) return
  const draft = await getTextDraft({ tenantId, id, branchId: user.branchId })
  if (!draft) {
    res.status(404).json({ error: 'Scheduled order not found', code: 'NOT_FOUND' })
    return
  }
  res.json(draft satisfies ScheduledOrdersTextDraftResponse)
})

/**
 * GET /api/scheduled-orders/:id/eligible-lots — the brands a nurse may pick for
 * this dose at their branch, house brand first then earliest-expiring. Feeds the
 * administer picker; the chosen lot comes back as `administer.lotId`.
 */
scheduledOrdersRouter.get('/:id/eligible-lots', async (req: Request, res: Response) => {
  const idParse = orderIdSchema.safeParse(req.params['id'])
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  if (user.branchId === null) {
    res.status(400).json({ error: 'Branch context required', code: 'BRANCH_REQUIRED' })
    return
  }
  if (!(await branchMayAccessOrder(req, res, idParse.data))) return
  try {
    const lots = await getEligibleLots({
      tenantId: req.tenant.id,
      branchId: user.branchId,
      id: idParse.data,
    })
    res.json(lots satisfies ScheduledOrdersEligibleLotsResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})

/** GET /api/scheduled-orders/:id/recompute-preview — dry-run downstream projection */
scheduledOrdersRouter.get('/:id/recompute-preview', async (req: Request, res: Response) => {
  const idParse = orderIdSchema.safeParse(req.params['id'])
  if (!idParse.success) {
    res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
    return
  }
  const tenantId = req.tenant.id
  const id = idParse.data
  if (!(await branchMayAccessOrder(req, res, id))) return
  const preview = await previewRecompute({ tenantId, id })
  res.json(preview satisfies ScheduledOrdersRecomputePreviewResponse)
})

/** POST /api/scheduled-orders/:id/recompute — apply downstream date recomputation */
scheduledOrdersRouter.post(
  '/:id/recompute',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const idParse = orderIdSchema.safeParse(req.params['id'])
    if (!idParse.success) {
      res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const id = idParse.data
    if (!(await branchMayAccessOrder(req, res, id))) return

    try {
      const result = await recomputeOrder(user, id)
      res.json(result satisfies ScheduledOrdersRecomputeResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

/** POST /api/scheduled-orders/:id/administer — atomic administration */
scheduledOrdersRouter.post(
  '/:id/administer',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  requireBranchOrderAccess,
  // statusColumn: null — clinical_order_status is capitalized
  // (Scheduled/Pending/Completed/...) so the lower-case default list never
  // matched, and an existing row already means the write committed.
  idempotency({ tableName: 'clinical_orders', statusColumn: null }),
  async (req: Request, res: Response) => {
    const idParse = orderIdSchema.safeParse(req.params['id'])
    if (!idParse.success) {
      res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
      return
    }
    const bodyParse = administerBody.safeParse(req.body)
    if (!bodyParse.success) {
      res.status(400).json({ error: 'Invalid request body', details: bodyParse.error.flatten() })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const id = idParse.data

    try {
      const result = await administerOrder(user, id, bodyParse.data, req.idempotencyKey)
      res.json(result satisfies ScheduledOrdersAdministerResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

/**
 * POST /api/scheduled-orders/:id/observation — explicit post-dose outcome or
 * discharge acknowledgement. Reaching observeUntil never calls this route.
 */
scheduledOrdersRouter.post(
  '/:id/observation',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const idParse = orderIdSchema.safeParse(req.params['id'])
    if (!idParse.success) {
      res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
      return
    }
    const bodyParse = observationActionBody.safeParse(req.body)
    if (!bodyParse.success) {
      res.status(400).json({ error: 'Invalid request body', details: bodyParse.error.flatten() })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const id = idParse.data
    if (!(await branchMayAccessOrder(req, res, id))) return

    try {
      const result = await recordObservationAction(user, id, bodyParse.data)
      res.json(result satisfies ScheduledOrdersObservationActionResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

/** POST /api/scheduled-orders/:id/reschedule — manual date override with reason */
scheduledOrdersRouter.post(
  '/:id/reschedule',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const idParse = orderIdSchema.safeParse(req.params['id'])
    if (!idParse.success) {
      res.status(400).json({ error: 'Invalid order id', code: 'INVALID_ID' })
      return
    }
    const bodyParse = rescheduleBody.safeParse(req.body)
    if (!bodyParse.success) {
      res.status(400).json({ error: 'Invalid request body', details: bodyParse.error.flatten() })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const id = idParse.data
    const { newDate, reason } = bodyParse.data
    if (!(await branchMayAccessOrder(req, res, id))) return

    try {
      const result = await rescheduleOrder(user, id, newDate, reason)
      res.json(result satisfies ScheduledOrdersRescheduleResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)
