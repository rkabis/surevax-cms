import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  displayIdSchema,
  prefixedDisplayIdSchema,
  branchDisplayIdSchema,
} from '../../shared/utils/displayId.js'
import { validate } from '../../shared/middleware/validate.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import * as service from './service.js'
import {
  resolveUserBigint,
  resolveBranchBigint,
  userBelongsToBranch,
  getActiveShiftRaw,
} from './db.js'

export const staffTimeLogsRouter: RouterType = Router()

// `userId` here is a USR_<…> display_id; `branchId` is a slug.CODE display_id.
const clockInSchema = z.object({
  branchId: branchDisplayIdSchema.optional(),
  userId: displayIdSchema.optional(),
  // Cash drawer — required for Cashier/Branch roles; ignored for others.
  openingFloat: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal string')
    .optional(),
})

const clockOutSchema = z.object({
  notes: z.string().max(500).optional(),
  userId: displayIdSchema.optional(),
  // Cash drawer — required when closing a session that was opened with a float.
  closingTotal: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal string')
    .optional(),
})

const logIdParams = z.object({ id: prefixedDisplayIdSchema('TLG') })
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() })

/** GET /api/staff-time-logs — list time logs for the tenant. */
staffTimeLogsRouter.get('/', validate(listQuery, 'query'), async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins cannot list time logs', code: 'FORBIDDEN' })
    return
  }
  const { limit } = req.query as { limit?: number }
  const logs = await service.listStaffTimeLogs(tenantId, user.id, user.branchId, limit)
  res.json(logs)
})

/** GET /api/staff-time-logs/active — returns today's open shift or null.
 *  Branch sessions can pass ?userId=<USR_…> to peek at another user's shift.
 *  MOD-2: reading another user's shift requires TenantAdmin or BranchAdmin role. */
staffTimeLogsRouter.get('/active', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins cannot view shifts', code: 'FORBIDDEN' })
    return
  }
  const rawUserParam = typeof req.query['userId'] === 'string' ? req.query['userId'] : null
  let targetUserBigint: number = user.id
  if (rawUserParam) {
    const parsed = displayIdSchema.safeParse(rawUserParam)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid userId', code: 'INVALID_ID' })
      return
    }
    const resolved = await resolveUserBigint(tenantId, parsed.data)
    if (resolved === null) {
      res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' })
      return
    }
    // MOD-2: only admins may read another user's shift (exposes float + declared + variance).
    if (resolved !== user.id) {
      const isAdmin = user.role === 'TenantAdmin' || user.role === 'BranchAdmin'
      if (!isAdmin) {
        res.status(403).json({ error: 'Cannot read another users active shift', code: 'FORBIDDEN' })
        return
      }
    }
    targetUserBigint = resolved
  }
  const log = await service.getActiveShift(tenantId, targetUserBigint, user.id, user.branchId)
  res.json({ data: log })
})

/** GET /api/staff-time-logs/:id — detail for a single time log with drawerSession. */
staffTimeLogsRouter.get(
  '/:id',
  validate(logIdParams, 'params'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot view shifts', code: 'FORBIDDEN' })
      return
    }
    const { id } = req.params as { id: string }
    const log = await service.getStaffTimeLogByDisplayId(tenantId, id, user.id, user.branchId)
    if (!log) {
      res.status(404).json({ error: 'Staff time log not found', code: 'NOT_FOUND' })
      return
    }
    res.json({ data: log })
  },
)

/** POST /api/staff-time-logs/clock-in — starts a new shift.
 *  Branch session: body must include `userId` (and optional `branchId`, defaults to caller's).
 *  Self session: ignores body.userId and clocks in the caller. */
staffTimeLogsRouter.post(
  '/clock-in',
  validate(clockInSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const body = req.body as { branchId?: string; userId?: string; openingFloat?: string }

    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot clock in', code: 'FORBIDDEN' })
      return
    }

    const isBranchSession = user.role === 'Branch'
    let targetUserBigint: number
    let branchBigint: number

    if (isBranchSession) {
      if (!body.userId) {
        res
          .status(400)
          .json({ error: 'userId is required for Branch sessions', code: 'VALIDATION_ERROR' })
        return
      }
      if (user.branchId === null) {
        res.status(400).json({ error: 'Branch session has no branchId', code: 'VALIDATION_ERROR' })
        return
      }

      // Resolve target branch (default to caller's branch).
      if (body.branchId) {
        const resolvedBranch = await resolveBranchBigint(tenantId, body.branchId)
        if (resolvedBranch === null) {
          res.status(404).json({ error: 'Branch not found', code: 'NOT_FOUND' })
          return
        }
        branchBigint = resolvedBranch
      } else {
        branchBigint = user.branchId
      }
      if (branchBigint !== user.branchId) {
        res.status(403).json({ error: 'Cross-branch clock-in not allowed', code: 'FORBIDDEN' })
        return
      }

      const resolvedUser = await resolveUserBigint(tenantId, body.userId)
      if (resolvedUser === null) {
        res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' })
        return
      }
      const ok = await userBelongsToBranch(tenantId, resolvedUser, branchBigint)
      if (!ok) {
        res.status(404).json({ error: 'User not at this branch', code: 'NOT_FOUND' })
        return
      }
      targetUserBigint = resolvedUser
    } else {
      if (!body.branchId) {
        res.status(400).json({ error: 'branchId is required', code: 'VALIDATION_ERROR' })
        return
      }
      const resolvedBranch = await resolveBranchBigint(tenantId, body.branchId)
      if (resolvedBranch === null) {
        res.status(404).json({ error: 'Branch not found', code: 'NOT_FOUND' })
        return
      }
      branchBigint = resolvedBranch
      targetUserBigint = user.id
    }

    // SHIFT-1: reject if the target user already has an open (un-clocked-out) shift today.
    const activeShift = await getActiveShiftRaw(tenantId, targetUserBigint)
    if (activeShift) {
      res
        .status(409)
        .json({ error: 'User already has an open shift today', code: 'SHIFT_ALREADY_OPEN' })
      return
    }

    // Open a cash drawer session when the user is a Cashier or Branch account.
    const shouldOpenDrawer = user.role === 'Cashier' || user.role === 'Branch'

    try {
      const log = await service.clockIn(
        tenantId,
        targetUserBigint,
        branchBigint,
        user.id,
        user.branchId,
        shouldOpenDrawer ? (body.openingFloat ?? null) : null,
      )
      res.status(201).json({ data: log })
    } catch (err: unknown) {
      // CONC-4: surface drawer double-open as 409 (race between two concurrent clock-ins).
      if ((err as NodeJS.ErrnoException).code === 'DRAWER_ALREADY_OPEN') {
        res.status(409).json({
          error: 'A drawer session is already open for this branch',
          code: 'DRAWER_ALREADY_OPEN',
        })
        return
      }
      throw err
    }
  },
)

/** POST /api/staff-time-logs/clock-out — ends the active shift.
 *  Branch session: body must include `userId` (the staff member being clocked out). */
staffTimeLogsRouter.post(
  '/clock-out',
  validate(clockOutSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const { notes, userId, closingTotal } = req.body as {
      notes?: string
      userId?: string
      closingTotal?: string
    }

    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot clock out', code: 'FORBIDDEN' })
      return
    }

    const isBranchSession = user.role === 'Branch'
    let targetUserBigint: number

    if (isBranchSession) {
      if (!userId) {
        res
          .status(400)
          .json({ error: 'userId is required for Branch sessions', code: 'VALIDATION_ERROR' })
        return
      }
      if (user.branchId === null) {
        res.status(400).json({ error: 'Branch session has no branchId', code: 'VALIDATION_ERROR' })
        return
      }
      const resolvedUser = await resolveUserBigint(tenantId, userId)
      if (resolvedUser === null) {
        res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' })
        return
      }
      const ok = await userBelongsToBranch(tenantId, resolvedUser, user.branchId)
      if (!ok) {
        res.status(404).json({ error: 'User not at this branch', code: 'NOT_FOUND' })
        return
      }
      targetUserBigint = resolvedUser
    } else {
      targetUserBigint = user.id
    }

    const log = await service.clockOut(
      tenantId,
      targetUserBigint,
      notes,
      user.id,
      user.branchId,
      closingTotal ?? null,
    )
    if (!log) {
      res.status(404).json({ error: 'No active shift found', code: 'NOT_FOUND' })
      return
    }
    res.json({ data: log })
  },
)
