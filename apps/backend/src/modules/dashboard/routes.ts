import { Router, type Router as RouterType, type Request, type Response } from 'express'
import * as queries from './db.js'
import { type DashboardListResponse, type DashboardNudgesResponse } from './contract.js'
import { getScheduledOrdersStats } from '../scheduled_orders/db.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

export const dashboardRouter: RouterType = Router()

function dashboardBranchId(req: Request, res: Response): number | null | undefined {
  const user = (req as Request & { user: AuthUser }).user
  if (user.role === 'TenantAdmin') return null
  if (user.branchId === null) {
    res.status(403).json({ error: 'Branch context required', code: 'BRANCH_REQUIRED' })
    return undefined
  }
  return user.branchId
}

/** GET /api/dashboard — aggregated stats for the dashboard page */
dashboardRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const branchId = dashboardBranchId(req, res)
  if (branchId === undefined) return
  const scope = { tenantId, branchId }

  const [baseStats, recentEncounters, scheduledOrdersDue, lowStock, orderStats] = await Promise.all(
    [
      queries.getDashboardStats(scope),
      queries.getRecentEncounters(scope),
      queries.getScheduledOrdersDue(scope),
      queries.getLowStockAlerts(scope),
      getScheduledOrdersStats(tenantId, branchId),
    ],
  )

  const stats = { ...baseStats, scheduledOrdersDueToday: orderStats.todayCount }

  res.json({
    stats,
    scheduledOrderStats: {
      dueCount: orderStats.todayCount,
      overdueCount: orderStats.overdueCount,
      backfillCount: orderStats.backfillCount,
      upcomingCount: orderStats.upcomingCount,
    },
    recentEncounters,
    scheduledOrdersDue,
    lowStock,
  } satisfies DashboardListResponse)
})

/** GET /api/dashboard/nudges — server-ranked priority queue of actionable items */
dashboardRouter.get('/nudges', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const branchId = dashboardBranchId(req, res)
  if (branchId === undefined) return
  const nudges = await queries.getNudges({ tenantId, branchId })
  res.json(nudges satisfies DashboardNudgesResponse)
})
