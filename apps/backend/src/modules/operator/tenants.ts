/**
 * tenants.ts — Platform admin cross-tenant tenants endpoint.
 *
 * GET /api/operator/tenants
 *   Returns a bare array of all tenants with branch counts.
 *   Requires isPlatformAdmin: true in the JWT.
 *   Uses withPlatformTx for cross-tenant RLS bypass.
 *
 * 4-column field-parity table for response shape:
 *   DB column          | Query alias   | Frontend type  | Notes
 *   tenants.id         | id            | string         | text PK (slug)
 *   tenants.name       | name          | string         |
 *   tenants.slug       | slug          | string         | unique
 *   COUNT(branches)    | branchCount   | number         | active branches
 *   tenants.created_at | createdAt     | string         | ISO timestamp
 */

import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../../shared/db/index.js'
import { tenants } from '../../shared/db/schema.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

export const operatorTenantsRouter: RouterType = Router()

operatorTenantsRouter.get('/', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user

  if (!user?.isPlatformAdmin) {
    res.status(403).json({ error: 'Forbidden', code: 'NOT_PLATFORM_ADMIN' })
    return
  }

  // Cross-tenant read — no audited write, so targetTenantId not required.
  // Set the platform admin GUC manually to bypass RLS tenant_isolation.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.is_platform_admin', 'true', true)`)
    await tx.execute(sql`select set_config('app.current_user_id', ${user.displayId}, true)`)

    return tx
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        createdAt: tenants.createdAt,
        branchCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM branches b
          WHERE b.tenant_id = tenants.id
            AND b.is_active = true
        )`,
      })
      .from(tenants)
      .orderBy(tenants.createdAt)
  })

  res.json(rows)
})
