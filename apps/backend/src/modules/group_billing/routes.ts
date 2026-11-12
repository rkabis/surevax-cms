import { Router, type Request, type Response, type Router as RouterType } from 'express'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validate.js'
import { idempotency } from '../../shared/middleware/idempotency.js'
import { wire } from '../../contracts/wire.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'
import {
  addGroupBillPayment,
  createGroupBill,
  getGroupBill,
  listGroupBills,
  voidGroupBill,
} from './db.js'
import {
  groupBillCreateSchema,
  groupBillDisplayId,
  groupBillListQuery,
  groupBillPaymentBodySchema,
  groupBillVoidBodySchema,
  type GroupBillCreateResponse,
  type GroupBillDetailResponse,
  type GroupBillListResponse,
  type GroupBillPaymentResponse,
  type GroupBillVoidResponse,
} from './contract.js'

export const groupBillingRouter: RouterType = Router()

const VOID_ROLES = new Set(['TenantAdmin', 'BranchAdmin'])

function getUser(req: Request): AuthUser {
  return (req as Request & { user: AuthUser }).user
}

function parseGroupBillId(req: Request, res: Response): string | null {
  const parsed = groupBillDisplayId.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid group bill id', code: 'INVALID_ID' })
    return null
  }
  return parsed.data
}

/** GET /api/group-bills — payer-owned AR, separate from patient receivables. */
groupBillingRouter.get('/', async (req, res) => {
  const parsed = groupBillListQuery.safeParse(req.query)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Invalid query', code: 'INVALID_QUERY', issues: parsed.error.issues })
    return
  }
  const data = await listGroupBills({
    tenantId: req.tenant.id,
    userId: req.tenant.userId ?? 0,
    branchId: req.tenant.branchId,
    status: parsed.data.status ?? 'open',
  })
  res.json(wire(data) satisfies GroupBillListResponse)
})

/** POST /api/group-bills — one corporate payer, 2–20 exact patient allocations. */
groupBillingRouter.post(
  '/',
  idempotency({ tableName: 'group_bills', statusColumn: null }),
  validate(groupBillCreateSchema),
  async (req, res) => {
    const user = getUser(req)
    if (user.id === null || user.branchId === null) {
      res.status(400).json({ error: 'A branch-assigned user is required', code: 'NO_BRANCH' })
      return
    }

    try {
      const result = await createGroupBill({
        tenantId: req.tenant.id,
        userId: user.id,
        branchId: user.branchId,
        moneyCaller: { kind: 'http', role: user.role, displayId: user.displayId },
        idempotencyKey: req.idempotencyKey,
        payload: req.body,
      })
      if (!result.ok) {
        res.status(result.status).json({
          error: result.error,
          code: result.code,
          ...(result.details ? { details: result.details } : {}),
        })
        return
      }
      res.status(201).json(result satisfies GroupBillCreateResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      const pgError = err as { code?: string; constraint_name?: string; constraint?: string }
      const pgCode = pgError.code
      const constraint = pgError.constraint_name ?? pgError.constraint
      if (pgCode === '23505' && constraint === 'clinical_order_single_live_bill') {
        res.status(409).json({
          error: 'A clinical order already has a live billing item',
          code: 'DUPLICATE_CLINICAL_ORDER',
        })
        return
      }
      if (pgCode === '23505') {
        res.status(409).json({
          error: 'Group bill conflicts with an existing billing record',
          code: 'DUPLICATE_GROUP_BILL',
        })
        return
      }
      if (pgCode === '23514') {
        res.status(409).json({
          error: 'Group bill rejected by a database invariant',
          code: 'CONSTRAINT_VIOLATION',
        })
        return
      }
      throw err
    }
  },
)

/** GET /api/group-bills/:id — payer AR plus exact patient/item allocation. */
groupBillingRouter.get('/:id', async (req, res) => {
  const groupBillDisplayId = parseGroupBillId(req, res)
  if (!groupBillDisplayId) return
  try {
    const data = await getGroupBill(
      { tenantId: req.tenant.id, userId: req.tenant.userId ?? 0, branchId: req.tenant.branchId },
      groupBillDisplayId,
    )
    res.json(wire(data) satisfies GroupBillDetailResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})

/** POST /api/group-bills/:id/payments — payer is forced to the group payer. */
groupBillingRouter.post(
  '/:id/payments',
  // Payments have no status column; replay is keyed by the committed row.
  idempotency({ tableName: 'payments', statusColumn: null }),
  validate(groupBillPaymentBodySchema),
  async (req, res) => {
    const groupBillDisplayId = parseGroupBillId(req, res)
    if (!groupBillDisplayId) return
    const user = getUser(req)
    if (user.id === null || user.branchId === null) {
      res.status(400).json({ error: 'A branch-assigned user is required', code: 'NO_BRANCH' })
      return
    }
    try {
      const result = await addGroupBillPayment({
        tenantId: req.tenant.id,
        userId: user.id,
        branchId: user.branchId,
        moneyCaller: { kind: 'http', role: user.role, displayId: user.displayId },
        groupBillDisplayId,
        idempotencyKey: req.idempotencyKey,
        payment: req.body,
      })
      res.status(201).json(result satisfies GroupBillPaymentResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

/** POST /api/group-bills/:id/void — admin-only due to payer AR impact. */
groupBillingRouter.post('/:id/void', validate(groupBillVoidBodySchema), async (req, res) => {
  const groupBillDisplayId = parseGroupBillId(req, res)
  if (!groupBillDisplayId) return
  const user = getUser(req)
  if (user.id === null || !VOID_ROLES.has(user.role)) {
    res
      .status(403)
      .json({ error: 'Only branch or tenant admins may void group bills', code: 'FORBIDDEN' })
    return
  }
  try {
    const result = await voidGroupBill({
      tenantId: req.tenant.id,
      userId: user.id,
      branchId: user.branchId,
      callerRole: user.role,
      groupBillDisplayId,
      reason: req.body.reason,
    })
    res.json(result satisfies GroupBillVoidResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})
