import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq } from 'drizzle-orm'
import { db } from '../../shared/db/index.js'
import { branches } from '../../shared/db/schema.js'
import { branchDisplayIdSchema } from '../../shared/utils/displayId.js'
import * as queries from './db.js'

export const branchRouter: RouterType = Router()

type AuthUser = { id: number; role: string; branchId: number | null }

/** Resolve a branch composite display_id ({slug}.{code}) → bigint within tenant. */
async function resolveBranchByDisplayId(
  tenantId: string,
  branchDisplayId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, branchDisplayId)))
    .limit(1)
  return row?.id ?? null
}

/**
 * Resolve target branch (internal bigint) for the kiosk endpoints.
 *
 * - Branch service-account users → use their own primary branchId (bigint).
 * - Admins → may pass ?branchId={slug}.{code} display id; resolved here.
 *   Falls back to the caller's primary branch when the query is missing.
 */
async function resolveTargetBranchId(req: Request): Promise<number | null> {
  const user = (req as Request & { user: AuthUser }).user
  if (user.role === 'Branch') return user.branchId
  const q = typeof req.query['branchId'] === 'string' ? req.query['branchId'] : undefined
  if (!q) return user.branchId
  // Admin supplied an explicit branch display id — validate + resolve.
  const parsed = branchDisplayIdSchema.safeParse(q)
  if (!parsed.success) return null
  return resolveBranchByDisplayId(req.tenant.id, parsed.data)
}

/** GET /api/branch/staff — kiosk roster: every active staff member at the
 *  caller's branch with current active-shift status. */
branchRouter.get('/staff', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const branchId = await resolveTargetBranchId(req)
  if (branchId == null) {
    res.status(400).json({ error: 'No branch context', code: 'VALIDATION_ERROR' })
    return
  }
  const data = await queries.listBranchStaff(tenantId, branchId)
  res.json({ data })
})

/** GET /api/branch/physicians — list physicians at the caller's branch. */
branchRouter.get('/physicians', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const branchId = await resolveTargetBranchId(req)
  if (branchId == null) {
    res.status(400).json({ error: 'No branch context', code: 'VALIDATION_ERROR' })
    return
  }
  const data = await queries.listBranchPhysicians(tenantId, branchId)
  res.json({ data })
})
