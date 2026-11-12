import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq, or, ilike, desc, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'
import { users, branches, userRoles, userBranches } from '../../shared/db/schema.js'
import { userPrimaryRoleSql } from '../../shared/db/userViews.js'
import { validate } from '../../shared/middleware/validate.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  displayId,
  prefixedDisplayIdSchema,
  branchDisplayIdSchema,
} from '../../shared/utils/displayId.js'
import { auditLog } from '../../shared/utils/auditLog.js'

export const adminUsersRouter: RouterType = Router()

// Cross-Branch PHI RFC Step 6 (reconciled): this admin endpoint lists / mutates
// `users` (and the `user_branches` / `user_roles` junctions) tenant-wide,
// scoped by `tenant_id`. `users` is tenant-wide reference data — NOT
// branch-scoped PHI — so the cross-branch roster view is intentional ADMIN
// OPERATIONAL access, not clinical break-glass. Writes pass the caller's real
// `req.tenant.branchId` to `withTenantTx` (NOT cross_branch_read), so the
// Step 7a WITH CHECK tightening does not affect them. No
// `cross_branch_access_grants` row is emitted (grants are reserved for genuine
// PHI chart reveals, D1). The RFC §4.4 synthetic-grant approach was rejected
// for admin reads.

// ── ID schemas ───────────────────────────────────────────────────────────────

const usrDisplayIdSchema = prefixedDisplayIdSchema('USR')

// ── Helpers ───────────────────────────────────────────────────────────────────

// F1 (2026-06-12 comprehensive review): vertical-privilege guard. The router
// mounts with requireRole('TenantAdmin','BranchAdmin'), so a BranchAdmin can
// reach every handler — without this guard they could mint a TenantAdmin or
// take over one by resetting its password/roles/PIN. Roles at or above
// BranchAdmin are admin-level; only a TenantAdmin caller may assign them or
// mutate the credentials/roles of a user who holds one.
const ADMIN_LEVEL_ROLES = new Set<string>(['TenantAdmin', 'SuperAdmin', 'BranchAdmin'])

function callerIsTenantAdmin(req: Request): boolean {
  return (req as Request & { user?: AuthUser }).user?.role === 'TenantAdmin'
}

function forbidEscalation(res: Response): void {
  res.status(403).json({
    error: 'Only a TenantAdmin may assign admin-level roles or modify admin-level users',
    code: 'ROLE_ESCALATION_FORBIDDEN',
  })
}

/** Resolve USR_ display_id → bigint + primary role within tenant. Runs on the caller's tx (FORCE RLS). */
async function resolveUser(
  tx: Tx,
  tenantId: string,
  usrDisplayId: string,
): Promise<{ id: number; primaryRole: string | null } | null> {
  const [row] = await tx
    .select({ id: users.id, primaryRole: userPrimaryRoleSql(users.id) })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.displayId, usrDisplayId)))
    .limit(1)
  return row ?? null
}

/** Resolve a branch composite display_id ({tenantSlug}.{code}) → bigint within tenant. */
async function resolveBranchId(
  tx: Tx,
  tenantId: string,
  branchDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, branchDisplayId)))
    .limit(1)
  return row?.id ?? null
}

/**
 * Fetch junction-table roles and branches for a set of internal user IDs.
 * Returns maps keyed by userId (bigint) for O(1) lookup during response assembly.
 * Branch surface uses the composite display_id ({slug}.{code}).
 */
async function fetchRolesAndBranches(
  tx: Tx,
  userIds: number[],
  tenantId: string,
): Promise<{
  rolesMap: Map<number, string[]>
  branchesMap: Map<number, { id: string; name: string | null }[]>
}> {
  if (userIds.length === 0) {
    return { rolesMap: new Map(), branchesMap: new Map() }
  }

  const [roleRows, branchRows] = await Promise.all([
    tx
      .select({ userId: userRoles.userId, role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, tenantId), inArray(userRoles.userId, userIds))),
    tx
      .select({
        userId: userBranches.userId,
        branchDisplayId: branches.displayId,
        branchName: branches.name,
      })
      .from(userBranches)
      .leftJoin(branches, eq(branches.id, userBranches.branchId))
      .where(and(eq(userBranches.tenantId, tenantId), inArray(userBranches.userId, userIds))),
  ])

  const rolesMap = new Map<number, string[]>()
  for (const r of roleRows) {
    const arr = rolesMap.get(r.userId) ?? []
    arr.push(r.role)
    rolesMap.set(r.userId, arr)
  }

  const branchesMap = new Map<number, { id: string; name: string | null }[]>()
  for (const r of branchRows) {
    const arr = branchesMap.get(r.userId) ?? []
    // branchDisplayId is nullable from the leftJoin; skip rows with no branch row.
    if (r.branchDisplayId) {
      arr.push({ id: r.branchDisplayId, name: r.branchName })
      branchesMap.set(r.userId, arr)
    }
  }

  return { rolesMap, branchesMap }
}

// ---------------------------------------------------------------------------
// GET /api/admin/users — list staff users with optional search and role filter
// ---------------------------------------------------------------------------

type RoleFilter = 'all' | 'Admin' | 'Physician' | 'Nurse' | 'Cashier' | 'Branch'
const VALID_ROLES = new Set(['all', 'Admin', 'Physician', 'Nurse', 'Cashier', 'Branch'])

adminUsersRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined
  const roleParam = typeof req.query['role'] === 'string' ? req.query['role'] : 'all'
  const role = VALID_ROLES.has(roleParam) ? (roleParam as RoleFilter) : 'all'

  const conditions = [eq(users.tenantId, tenantId)]

  if (q) {
    const pattern = `%${q}%`
    conditions.push(
      or(
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
        ilike(users.email, pattern),
      )!,
    )
  }

  // Role filtering goes through the user_roles junction table.
  if (role === 'Admin') {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = ${users.id}
          AND ur.role IN ('TenantAdmin','SuperAdmin','BranchAdmin')
      )`,
    )
  } else if (role !== 'all') {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = ${users.id}
          AND ur.role = ${role}
      )`,
    )
  }

  // Read inside withTenantTx — bare db reads return zero rows under FORCE RLS
  // (userId 0 is the SELECT-only sentinel; branchId null = tenant-wide admin read).
  const { rows, rolesMap, branchesMap } = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) => {
      const rows = await tx
        .select({
          id: users.id,
          displayId: users.displayId,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: userPrimaryRoleSql(users.id),
          isActive: users.isActive,
          canLogin: users.canLogin,
          lastLoginAt: users.lastLoginAt,
          licenseNumber: users.licenseNumber,
        })
        .from(users)
        .where(and(...conditions))
        .orderBy(desc(users.lastLoginAt))

      const maps = await fetchRolesAndBranches(
        tx,
        rows.map((r) => r.id),
        tenantId,
      )
      return { rows, ...maps }
    },
  )

  const activeCount = rows.filter((u) => u.isActive).length

  res.json({
    data: rows.map((r) => ({
      id: r.displayId,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      role: r.role ?? '',
      isActive: r.isActive,
      canLogin: r.canLogin,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      licenseNumber: r.licenseNumber,
      roles: rolesMap.get(r.id) ?? [],
      branches: branchesMap.get(r.id) ?? [],
    })),
    activeCount,
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id — detail row joined with primary branch + creator
// ---------------------------------------------------------------------------

adminUsersRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const idParsed = usrDisplayIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid user id', code: 'INVALID_ID' })
    return
  }
  const usrDisplayId = idParsed.data

  const creator = alias(users, 'creator')

  const detail = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) => {
      const [row] = await tx
        .select({
          id: users.id,
          displayId: users.displayId,
          tenantId: users.tenantId,
          primaryBranchInternalId: users.primaryBranchId,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          role: userPrimaryRoleSql(users.id),
          licenseNumber: users.licenseNumber,
          isActive: users.isActive,
          canLogin: users.canLogin,
          lastLoginAt: users.lastLoginAt,
          passwordHash: users.passwordHash,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          createdByInternalId: users.createdById,
          branchName: branches.name,
          branchCode: branches.code,
          branchDisplayId: branches.displayId,
          createdByEmail: creator.email,
          createdByDisplayId: creator.displayId,
          createdByFirstName: creator.firstName,
          createdByLastName: creator.lastName,
        })
        .from(users)
        .leftJoin(branches, eq(branches.id, users.primaryBranchId))
        .leftJoin(creator, eq(creator.id, users.createdById))
        .where(and(eq(users.displayId, usrDisplayId), eq(users.tenantId, tenantId)))
        .limit(1)

      if (!row) return null
      const maps = await fetchRolesAndBranches(tx, [row.id], tenantId)
      return { row, ...maps }
    },
  )

  if (!detail) {
    res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' })
    return
  }
  const { row, rolesMap, branchesMap } = detail

  res.json({
    id: row.displayId,
    tenantId: row.tenantId,
    branchId: row.branchDisplayId ?? null,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role ?? '',
    roles: rolesMap.get(row.id) ?? [],
    licenseNumber: row.licenseNumber,
    isActive: row.isActive,
    canLogin: row.canLogin,
    hasPassword: Boolean(row.passwordHash),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    createdById: row.createdByDisplayId ?? null,
    branch: row.branchDisplayId
      ? { id: row.branchDisplayId, name: row.branchName, code: row.branchCode }
      : null,
    branches: branchesMap.get(row.id) ?? [],
    createdBy: row.createdByInternalId
      ? {
          id: row.createdByDisplayId,
          email: row.createdByEmail,
          firstName: row.createdByFirstName,
          lastName: row.createdByLastName,
        }
      : null,
  })
})

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ROLE_VALUES = [
  'TenantAdmin',
  'SuperAdmin',
  'BranchAdmin',
  'Physician',
  'Nurse',
  'Cashier',
  'Branch',
] as const
type Role = (typeof ROLE_VALUES)[number]

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
  role: z.enum(ROLE_VALUES).optional(),
  roles: z.array(z.enum(ROLE_VALUES)).min(1).optional(),
  branchId: branchDisplayIdSchema.optional(),
  branches: z.array(branchDisplayIdSchema).min(1).optional(),
  licenseNumber: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
  canLogin: z.boolean().optional(),
})

const updateUserSchema = z
  .object({
    canLogin: z.boolean().optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
    role: z.enum(ROLE_VALUES).optional(),
    roles: z.array(z.enum(ROLE_VALUES)).min(1).optional(),
    branchId: branchDisplayIdSchema.optional(),
    branches: z.array(branchDisplayIdSchema).min(1).optional(),
  })
  .refine(
    (v) =>
      v.canLogin !== undefined ||
      v.isActive !== undefined ||
      v.password !== undefined ||
      v.role !== undefined ||
      v.roles !== undefined ||
      v.branchId !== undefined ||
      v.branches !== undefined,
    { message: 'At least one field must be provided' },
  )

// ---------------------------------------------------------------------------
// POST /api/admin/users — create a staff user
// ---------------------------------------------------------------------------

adminUsersRouter.post('/', validate(createUserSchema), async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const reqUserId = req.tenant.userId
  const reqBranchId = req.tenant.branchId
  if (reqUserId === null) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
    return
  }
  const body = req.body as z.infer<typeof createUserSchema>

  // Prefer arrays when both are provided; fall back to scalar.
  const resolvedRoles: Role[] = body.roles ?? (body.role ? [body.role] : [])
  const resolvedBranchDisplayIds: string[] = body.branches ?? (body.branchId ? [body.branchId] : [])

  if (resolvedRoles.length === 0) {
    res.status(400).json({ error: 'role or roles is required', code: 'ROLE_REQUIRED' })
    return
  }

  if (!callerIsTenantAdmin(req) && resolvedRoles.some((r) => ADMIN_LEVEL_ROLES.has(r))) {
    forbidEscalation(res)
    return
  }

  // Resolve every branch display_id → bigint up front; bail if any is unknown.
  // Pre-write reads run in their own tenant tx (FORCE RLS empties bare reads).
  const { branchIdResolutions, dupe } = await withTenantTx(
    { tenantId, userId: reqUserId, branchId: null },
    async (tx) => {
      const branchIdResolutions = await Promise.all(
        resolvedBranchDisplayIds.map((d) => resolveBranchId(tx, tenantId, d)),
      )
      // Check email uniqueness before hashing (cheap guard).
      const [dupe] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.email, body.email)))
        .limit(1)
      return { branchIdResolutions, dupe }
    },
  )
  if (branchIdResolutions.some((v) => v === null)) {
    res.status(400).json({ error: 'Unknown branchId', code: 'INVALID_BRANCH' })
    return
  }
  const internalBranchIds = branchIdResolutions as number[]
  const primaryBranchInternalId = internalBranchIds[0] ?? null

  if (dupe) {
    res.status(409).json({ error: 'Email already in use', code: 'EMAIL_CONFLICT' })
    return
  }

  const passwordHash = await bcrypt.hash(body.password, 12)
  const usrDisplayId = displayId('USR')
  const now = new Date()

  const created = await withTenantTx(
    { tenantId, userId: reqUserId, branchId: reqBranchId },
    async (tx) => {
      // 1. Insert the user row — DB generates bigint id; we supply USR_ display_id.
      const [newUser] = await tx
        .insert(users)
        .values({
          displayId: usrDisplayId,
          tenantId,
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          passwordHash,
          primaryBranchId: primaryBranchInternalId,
          licenseNumber: body.licenseNumber ?? null,
          isActive: body.isActive ?? true,
          canLogin: body.canLogin ?? true,
          createdById: reqUserId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      if (!newUser) throw new Error('Insert returned no row')

      // 2. Insert junction user_roles rows (one per role).
      for (const role of resolvedRoles) {
        await tx.insert(userRoles).values({
          tenantId,
          userId: newUser.id,
          role,
          branchId: primaryBranchInternalId,
          assignedAt: now,
          assignedById: reqUserId,
        })
      }

      // 3. Insert junction user_branches rows (one per branch).
      for (const branchInternalId of internalBranchIds) {
        await tx.insert(userBranches).values({
          tenantId,
          userId: newUser.id,
          branchId: branchInternalId,
          assignedAt: now,
          assignedById: reqUserId,
        })
      }

      // 4. Emit semantic PERMISSION_CHANGE audit row for the role/branch assignment.
      await auditLog(tx, {
        tenantId,
        userId: reqUserId,
        branchId: reqBranchId ?? null,
        action: 'PERMISSION_CHANGE',
        entityType: 'users',
        entityId: newUser.displayId,
        changes: {
          roles: resolvedRoles,
          branches: resolvedBranchDisplayIds,
        },
        metadata: { operation: 'create' },
        ipAddress: req.ip ?? null,
        userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
      })

      return newUser
    },
  )

  res.status(201).json({
    id: created.displayId,
    email: created.email,
    firstName: created.firstName,
    lastName: created.lastName,
    role: resolvedRoles[0],
    roles: resolvedRoles,
    branchId: resolvedBranchDisplayIds[0] ?? null,
    primaryBranchId: resolvedBranchDisplayIds[0] ?? null,
    branches: resolvedBranchDisplayIds,
    isActive: created.isActive,
    canLogin: created.canLogin,
    createdAt: created.createdAt?.toISOString() ?? null,
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id — admin-side updates
// ---------------------------------------------------------------------------

adminUsersRouter.patch('/:id', validate(updateUserSchema), async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const reqUserId = req.tenant.userId
  const reqBranchId = req.tenant.branchId
  if (reqUserId === null) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
    return
  }
  const idParsed = usrDisplayIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid user id', code: 'INVALID_ID' })
    return
  }
  const usrDisplayId = idParsed.data
  const body = req.body as z.infer<typeof updateUserSchema>

  const [existing] = await withTenantTx(
    { tenantId, userId: reqUserId, branchId: null },
    async (tx) =>
      tx
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          primaryBranchId: users.primaryBranchId,
          primaryRole: userPrimaryRoleSql(users.id),
        })
        .from(users)
        .where(and(eq(users.displayId, usrDisplayId), eq(users.tenantId, tenantId)))
        .limit(1),
  )

  if (!existing) {
    res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' })
    return
  }
  const internalId = existing.id

  const wantsLogin = body.canLogin === true
  const hasPassword = Boolean(existing.passwordHash)
  if (wantsLogin && !hasPassword && !body.password) {
    res.status(400).json({
      error: 'Cannot enable login without a password — include `password` in this request.',
      code: 'PASSWORD_REQUIRED',
    })
    return
  }

  // Resolve scalar/array inputs. Prefer arrays when both are provided.
  const resolvedRoles: Role[] | undefined = body.roles ?? (body.role ? [body.role] : undefined)
  const resolvedBranchDisplayIds: string[] | undefined =
    body.branches ?? (body.branchId ? [body.branchId] : undefined)

  if (!callerIsTenantAdmin(req)) {
    const assignsAdminRole = resolvedRoles?.some((r) => ADMIN_LEVEL_ROLES.has(r)) ?? false
    const targetIsAdmin = ADMIN_LEVEL_ROLES.has(existing.primaryRole ?? '')
    const touchesCredsOrRoles = body.password !== undefined || resolvedRoles !== undefined
    if (assignsAdminRole || (targetIsAdmin && touchesCredsOrRoles)) {
      forbidEscalation(res)
      return
    }
  }

  let resolvedBranchInternalIds: number[] | undefined
  if (resolvedBranchDisplayIds !== undefined) {
    const resolutions = await withTenantTx(
      { tenantId, userId: reqUserId, branchId: null },
      async (tx) =>
        Promise.all(resolvedBranchDisplayIds.map((d) => resolveBranchId(tx, tenantId, d))),
    )
    if (resolutions.some((v) => v === null)) {
      res.status(400).json({ error: 'Unknown branchId', code: 'INVALID_BRANCH' })
      return
    }
    resolvedBranchInternalIds = resolutions as number[]
  }

  const newPrimaryBranchInternalId =
    resolvedBranchInternalIds !== undefined ? (resolvedBranchInternalIds[0] ?? null) : undefined

  const userUpdate: Record<string, unknown> = { updatedAt: new Date() }
  if (body.canLogin !== undefined) userUpdate['canLogin'] = body.canLogin
  if (body.isActive !== undefined) userUpdate['isActive'] = body.isActive
  if (body.password) userUpdate['passwordHash'] = await bcrypt.hash(body.password, 12)
  if (newPrimaryBranchInternalId !== undefined) {
    userUpdate['primaryBranchId'] = newPrimaryBranchInternalId
  }

  const now = new Date()

  const updated = await withTenantTx(
    { tenantId, userId: reqUserId, branchId: reqBranchId },
    async (tx) => {
      // 1. Update users row (login state, password, primary branch).
      await tx
        .update(users)
        .set(userUpdate)
        .where(and(eq(users.id, internalId), eq(users.tenantId, tenantId)))

      // 2. Replace user_roles rows when roles changed.
      let previousRoles: string[] | undefined
      if (resolvedRoles !== undefined) {
        // Capture previous roles before deleting (for the audit trail).
        const prevRoleRows = await tx
          .select({ role: userRoles.role })
          .from(userRoles)
          .where(and(eq(userRoles.userId, internalId), eq(userRoles.tenantId, tenantId)))
        previousRoles = prevRoleRows.map((r) => r.role)

        await tx
          .delete(userRoles)
          .where(and(eq(userRoles.userId, internalId), eq(userRoles.tenantId, tenantId)))
        for (const role of resolvedRoles) {
          await tx.insert(userRoles).values({
            tenantId,
            userId: internalId,
            role,
            branchId: newPrimaryBranchInternalId ?? existing.primaryBranchId,
            assignedAt: now,
            assignedById: reqUserId,
          })
        }
      }

      // 3. Replace user_branches rows when branches changed.
      let previousBranches: string[] | undefined
      if (resolvedBranchInternalIds !== undefined) {
        // Capture previous branches before deleting (for the audit trail).
        const prevBranchRows = await tx
          .select({ branchDisplayId: branches.displayId })
          .from(userBranches)
          .leftJoin(branches, eq(branches.id, userBranches.branchId))
          .where(and(eq(userBranches.userId, internalId), eq(userBranches.tenantId, tenantId)))
        previousBranches = prevBranchRows
          .map((r) => r.branchDisplayId)
          .filter((d): d is string => d !== null)

        await tx
          .delete(userBranches)
          .where(and(eq(userBranches.userId, internalId), eq(userBranches.tenantId, tenantId)))
        for (const branchInternalId of resolvedBranchInternalIds) {
          await tx.insert(userBranches).values({
            tenantId,
            userId: internalId,
            branchId: branchInternalId,
            assignedAt: now,
            assignedById: reqUserId,
          })
        }
      }

      // 4. Emit semantic PERMISSION_CHANGE audit row when roles or branches were mutated.
      if (resolvedRoles !== undefined || resolvedBranchInternalIds !== undefined) {
        await auditLog(tx, {
          tenantId,
          userId: reqUserId,
          branchId: reqBranchId ?? null,
          action: 'PERMISSION_CHANGE',
          entityType: 'users',
          entityId: usrDisplayId,
          changes: {
            ...(resolvedRoles !== undefined ? { roles: resolvedRoles } : {}),
            ...(resolvedBranchDisplayIds !== undefined
              ? { branches: resolvedBranchDisplayIds }
              : {}),
            previous: {
              ...(previousRoles !== undefined ? { roles: previousRoles } : {}),
              ...(previousBranches !== undefined ? { branches: previousBranches } : {}),
            },
          },
          metadata: { operation: 'update' },
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
        })
      }

      // 5. Return updated user (read junction tables for the canonical role + branch).
      const [updatedRow] = await tx
        .select({
          id: users.id,
          displayId: users.displayId,
          role: userPrimaryRoleSql(users.id),
          primaryBranchInternalId: users.primaryBranchId,
          branchDisplayId: branches.displayId,
          isActive: users.isActive,
          canLogin: users.canLogin,
        })
        .from(users)
        .leftJoin(branches, eq(branches.id, users.primaryBranchId))
        .where(and(eq(users.id, internalId), eq(users.tenantId, tenantId)))
        .limit(1)
      return updatedRow
    },
  )

  res.json({
    ok: true,
    id: updated?.displayId ?? usrDisplayId,
    role: updated?.role ?? '',
    branchId: updated?.branchDisplayId ?? null,
    isActive: updated?.isActive,
    canLogin: updated?.canLogin,
  })
})

// ---------------------------------------------------------------------------
// PIN management
// ---------------------------------------------------------------------------

const resetPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, '4 digits required'),
})

/** POST /api/admin/users/:id/reset-pin — set or replace a kiosk PIN */
adminUsersRouter.post(
  '/:id/reset-pin',
  validate(resetPinSchema),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const reqUserId = req.tenant.userId
    const reqBranchId = req.tenant.branchId
    if (reqUserId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const idParsed = usrDisplayIdSchema.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid user id', code: 'INVALID_ID' })
      return
    }
    const usrDisplayId = idParsed.data
    const { pin } = req.body as z.infer<typeof resetPinSchema>

    const target = await withTenantTx({ tenantId, userId: reqUserId, branchId: null }, async (tx) =>
      resolveUser(tx, tenantId, usrDisplayId),
    )
    if (target === null) {
      res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' })
      return
    }
    if (!callerIsTenantAdmin(req) && ADMIN_LEVEL_ROLES.has(target.primaryRole ?? '')) {
      forbidEscalation(res)
      return
    }
    const internalId = target.id

    const pinHash = await bcrypt.hash(pin, 10)

    await withTenantTx({ tenantId, userId: reqUserId, branchId: reqBranchId }, async (tx) => {
      await tx
        .update(users)
        .set({ pinHash, updatedAt: new Date() })
        .where(and(eq(users.id, internalId), eq(users.tenantId, tenantId)))
    })

    res.json({ ok: true })
  },
)

/** DELETE /api/admin/users/:id/pin — clear the kiosk PIN */
adminUsersRouter.delete('/:id/pin', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const reqUserId = req.tenant.userId
  const reqBranchId = req.tenant.branchId
  if (reqUserId === null) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
    return
  }
  const idParsed = usrDisplayIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid user id', code: 'INVALID_ID' })
    return
  }
  const usrDisplayId = idParsed.data

  const target = await withTenantTx({ tenantId, userId: reqUserId, branchId: null }, async (tx) =>
    resolveUser(tx, tenantId, usrDisplayId),
  )
  if (target === null) {
    res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' })
    return
  }
  if (!callerIsTenantAdmin(req) && ADMIN_LEVEL_ROLES.has(target.primaryRole ?? '')) {
    forbidEscalation(res)
    return
  }
  const internalId = target.id

  await withTenantTx({ tenantId, userId: reqUserId, branchId: reqBranchId }, async (tx) => {
    await tx
      .update(users)
      .set({ pinHash: null, updatedAt: new Date() })
      .where(and(eq(users.id, internalId), eq(users.tenantId, tenantId)))
  })

  res.json({ ok: true })
})
