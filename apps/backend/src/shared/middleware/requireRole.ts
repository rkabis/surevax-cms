import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AuthUser } from './auth.js'

/**
 * Express middleware factory that enforces role-based access on a route or router.
 *
 * Reads `req.user.role` (attached by `authMiddleware`) and rejects with 403 when
 * the role is not in the allow-list. Returns 401 defensively if no user is
 * attached — this should never happen when mounted after `authMiddleware`.
 *
 * @example
 *   app.use('/api/admin/users', requireRole('TenantAdmin', 'BranchAdmin'), adminUsersRouter)
 */
export function requireRole(...roles: string[]): RequestHandler {
  const allowed = new Set(roles)
  return function roleGuard(req: Request, res: Response, next: NextFunction): void {
    const user = (req as Request & { user?: AuthUser }).user
    if (!user) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      return
    }
    if (!allowed.has(user.role)) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
      return
    }
    next()
  }
}
