import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { validate } from '../../shared/middleware/validate.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { getCurrentShift, getShiftByDisplayId, getDrawerSessionForShift } from './db.js'

export const shiftsRouter: RouterType = Router()

const shiftIdParams = z.object({ id: prefixedDisplayIdSchema('TLG') })

/** GET /api/shifts/current — returns the caller's current open shift with
 *  drawer fields enriched (float, collected so far, state, cashier name).
 *  `null` if no open shift today. */
shiftsRouter.get('/current', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins have no shift', code: 'FORBIDDEN' })
    return
  }

  const shift = await getCurrentShift({
    tenantId,
    userId: user.id,
    branchId: user.branchId,
  })

  res.json({ data: shift })
})

/** GET /api/shifts/:id — returns a specific shift by id (TLG_…) with drawerSession.
 *
 *  MOD-1: any authenticated tenant user can guess a TLG_… id and read another
 *  staff member's shift. Fix: restrict the lookup to the caller's own shift
 *  unless they have an admin role (TenantAdmin / BranchAdmin), mirroring the
 *  MOD-2 pattern in staff_time_logs/routes.ts.
 */
shiftsRouter.get('/:id', validate(shiftIdParams, 'params'), async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  const { id } = req.params as { id: string }

  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins cannot view shifts', code: 'FORBIDDEN' })
    return
  }

  const isAdmin = user.role === 'TenantAdmin' || user.role === 'BranchAdmin'

  const shift = await getShiftByDisplayId(
    { tenantId, userId: user.id, branchId: user.branchId },
    id,
  )

  if (!shift) {
    res.status(404).json({ error: 'Shift not found', code: 'NOT_FOUND' })
    return
  }

  // Non-admins can only view their own shift — return 404 (not 403) to avoid
  // leaking the existence of another user's shift via a guessed TLG_… id.
  if (!isAdmin && shift.userId !== user.displayId) {
    res.status(404).json({ error: 'Shift not found', code: 'NOT_FOUND' })
    return
  }

  res.json({ data: shift })
})

/** GET /api/shifts/:id/drawer — returns the cash_drawer_sessions row for a shift. */
shiftsRouter.get(
  '/:id/drawer',
  validate(shiftIdParams, 'params'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const { id } = req.params as { id: string }

    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot view shifts', code: 'FORBIDDEN' })
      return
    }

    const drawerSession = await getDrawerSessionForShift(
      { tenantId, userId: user.id, branchId: user.branchId },
      id,
    )

    res.json({ data: drawerSession })
  },
)
