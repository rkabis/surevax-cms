import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { validate } from '../../shared/middleware/validate.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  getCurrentDrawerSession,
  openDrawerSession,
  closeDrawerSession,
  recordDeposit,
  voidDeposit,
} from './db.js'

export const cashDrawerRouter: RouterType = Router()

const moneyRegex = /^\d+(\.\d{1,2})?$/

const cshIdSchema = prefixedDisplayIdSchema('CSH')
const depIdParams = z.object({ id: prefixedDisplayIdSchema('DEP') })

const openBodySchema = z.object({
  openingFloat: z.string().regex(moneyRegex, 'Opening float must be a valid decimal amount'),
})

const closeBodySchema = z.object({
  sessionId: cshIdSchema,
  closingTotalDeclared: z
    .string()
    .regex(moneyRegex, 'Closing total declared must be a valid decimal amount'),
})

const depositBodySchema = z.object({
  amount: z
    .string()
    .regex(moneyRegex, 'Amount must be a valid decimal amount')
    .refine((v) => parseFloat(v) > 0, 'Amount must be greater than zero'),
  depositSlipNumber: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(500).optional(),
})

const voidDepositBodySchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
})

/** GET /api/cash-drawer/current
 *  Returns the oldest currently-Open drawer session for the caller's branch,
 *  including an unclosed prior-day session, or 404 if none is open. */
cashDrawerRouter.get('/current', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins cannot operate cash drawer', code: 'FORBIDDEN' })
    return
  }

  const session = await getCurrentDrawerSession({
    tenantId,
    userId: user.id,
    branchId: user.branchId,
  })

  if (!session) {
    res.status(404).json({ error: 'No open drawer session', code: 'NOT_FOUND' })
    return
  }

  res.json(session)
})

/** POST /api/cash-drawer/open
 *  Creates a new Open cash_drawer_sessions row for the caller's branch.
 *  Returns 409 if this branch has any open session. */
cashDrawerRouter.post(
  '/open',
  validate(openBodySchema, 'body'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const { openingFloat } = req.body as z.infer<typeof openBodySchema>

    if (user.id === null) {
      res
        .status(403)
        .json({ error: 'Platform admins cannot operate cash drawer', code: 'FORBIDDEN' })
      return
    }
    if (user.branchId === null) {
      res.status(400).json({ error: 'User has no branch assigned', code: 'NO_BRANCH' })
      return
    }

    try {
      const session = await openDrawerSession(
        { tenantId, userId: user.id, branchId: user.branchId },
        openingFloat,
      )
      res.status(201).json(session)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'DRAWER_ALREADY_OPEN') {
        res.status(409).json({ error: 'A drawer session is already open for this branch', code })
        return
      }
      throw err
    }
  },
)

/** POST /api/cash-drawer/close
 *  Closes the identified drawer session. Server computes expected total from
 *  Cash payments and deposits linked to the session; variance = declared − expected.
 *  Returns 404 if session not found, 409 if already closed. */
cashDrawerRouter.post(
  '/close',
  validate(closeBodySchema, 'body'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const { sessionId, closingTotalDeclared } = req.body as z.infer<typeof closeBodySchema>

    if (user.id === null) {
      res
        .status(403)
        .json({ error: 'Platform admins cannot operate cash drawer', code: 'FORBIDDEN' })
      return
    }
    if (user.branchId === null) {
      res.status(400).json({ error: 'User has no branch assigned', code: 'NO_BRANCH' })
      return
    }

    try {
      const session = await closeDrawerSession(
        { tenantId, userId: user.id, branchId: user.branchId },
        sessionId,
        closingTotalDeclared,
      )
      res.json(session)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'NOT_FOUND') {
        res.status(404).json({ error: 'Drawer session not found', code })
        return
      }
      if (code === 'DRAWER_NOT_OPEN') {
        res.status(409).json({ error: 'Drawer session is already closed', code })
        return
      }
      throw err
    }
  },
)

/** POST /api/cash-drawer/deposits
 *  Records a cash-out-to-the-bank deposit against the caller's currently-Open
 *  drawer session. Returns 409 if no drawer session is open for the branch. */
cashDrawerRouter.post(
  '/deposits',
  validate(depositBodySchema, 'body'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const body = req.body as z.infer<typeof depositBodySchema>

    if (user.id === null) {
      res
        .status(403)
        .json({ error: 'Platform admins cannot operate cash drawer', code: 'FORBIDDEN' })
      return
    }
    if (user.branchId === null) {
      res.status(400).json({ error: 'User has no branch assigned', code: 'NO_BRANCH' })
      return
    }

    try {
      const deposit = await recordDeposit(
        { tenantId, userId: user.id, branchId: user.branchId },
        body,
      )
      res.status(201).json(deposit)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'NO_OPEN_DRAWER') {
        res.status(409).json({ error: 'No open drawer session to deposit from', code })
        return
      }
      throw err
    }
  },
)

/** POST /api/cash-drawer/deposits/:id/void
 *  Voids a previously-recorded deposit. Inline + logged, not an approval
 *  queue. Refused once the owning drawer session has already closed. */
cashDrawerRouter.post(
  '/deposits/:id/void',
  validate(depIdParams, 'params'),
  validate(voidDepositBodySchema, 'body'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const { id } = req.params as { id: string }
    const { reason } = req.body as z.infer<typeof voidDepositBodySchema>

    if (user.id === null) {
      res
        .status(403)
        .json({ error: 'Platform admins cannot operate cash drawer', code: 'FORBIDDEN' })
      return
    }
    if (user.branchId === null) {
      res.status(400).json({ error: 'User has no branch assigned', code: 'NO_BRANCH' })
      return
    }

    try {
      const deposit = await voidDeposit(
        { tenantId, userId: user.id, branchId: user.branchId },
        id,
        reason,
      )
      res.json(deposit)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'NOT_FOUND') {
        res.status(404).json({ error: 'Deposit not found', code })
        return
      }
      if (code === 'ALREADY_VOIDED') {
        res.status(409).json({ error: 'Deposit is already voided', code })
        return
      }
      if (code === 'DRAWER_CLOSED') {
        res
          .status(409)
          .json({ error: 'Cannot void a deposit after its drawer session has closed', code })
        return
      }
      throw err
    }
  },
)
