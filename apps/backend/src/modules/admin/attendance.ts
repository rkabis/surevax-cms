import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq, desc, ilike, or, sql, count } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../shared/db/index.js'
import { staffTimeLogs, users, branches, cashDrawerSessions } from '../../shared/db/schema.js'
import { userPrimaryRoleSql } from '../../shared/db/userViews.js'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'

export const adminAttendanceRouter: RouterType = Router()

const tlgDisplayIdSchema = prefixedDisplayIdSchema('TLG')

/**
 * Cursor encoding: base64("<clock_in_at_iso>|<bigint_id>")
 * Ordering: (clock_in_at DESC, id DESC) for stability.
 * The id stored in the cursor is the internal bigint — it's an opaque server
 * pagination token (never surfaced to the API consumer in any other shape).
 * TODO Phase 2: switch X-Total-Count to estimated count via pg_stat or
 * materialized view if scale warrants.
 */
function encodeCursor(clockInAt: Date, id: number): string {
  return Buffer.from(`${clockInAt.toISOString()}|${id}`).toString('base64')
}

function decodeCursor(cursor: string): { ts: Date; id: number } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8')
    const pipe = raw.lastIndexOf('|')
    if (pipe === -1) return null
    const id = parseInt(raw.slice(pipe + 1), 10)
    if (!Number.isFinite(id)) return null
    return { ts: new Date(raw.slice(0, pipe)), id }
  } catch {
    return null
  }
}

const listQuerySchema = z.object({
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * LEFT JOIN condition for cash_drawer_sessions — matches same user + branch
 * on the same calendar day as the clock-in timestamp.
 */
const drawerJoinCondition = sql`
  ${cashDrawerSessions.tenantId} = ${staffTimeLogs.tenantId}
  AND ${cashDrawerSessions.userId} = ${staffTimeLogs.userId}
  AND ${cashDrawerSessions.branchId} = ${staffTimeLogs.branchId}
  AND DATE(${cashDrawerSessions.openedAt}) = DATE(${staffTimeLogs.clockInAt})
`

type DrawerRow = {
  drawerState: string | null
  openingFloat: string | null
  closingTotalDeclared: string | null
  variance: string | null
}

function buildDrawerSession(r: DrawerRow) {
  if (r.drawerState == null) return null
  return {
    state: r.drawerState,
    openingFloat: r.openingFloat,
    closingTotalDeclared: r.closingTotalDeclared ?? null,
    variance: r.variance ?? null,
  }
}

/** GET /api/admin/attendance — staff time logs with user details + drawerSession enrichment */
adminAttendanceRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id

  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PARAMS', details: parsed.error.flatten() })
    return
  }

  const { q, cursor, limit } = parsed.data

  // Filter conditions (excluding cursor — used for total count)
  const filterConditions = [eq(staffTimeLogs.tenantId, tenantId)]

  if (q) {
    const pattern = `%${q}%`
    filterConditions.push(or(ilike(users.firstName, pattern), ilike(users.lastName, pattern))!)
  }

  // Cursor conditions (added on top of filters for the page query)
  const pageConditions = [...filterConditions]
  if (cursor) {
    const decoded = decodeCursor(cursor)
    if (decoded) {
      pageConditions.push(
        sql`(${staffTimeLogs.clockInAt}, ${staffTimeLogs.id}) < (${decoded.ts.toISOString()}::timestamptz, ${decoded.id})`,
      )
    }
  }

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: staffTimeLogs.id,
        displayId: staffTimeLogs.displayId,
        userDisplayId: users.displayId,
        staffFirstName: users.firstName,
        staffLastName: users.lastName,
        role: userPrimaryRoleSql(users.id),
        clockInAt: staffTimeLogs.clockInAt,
        clockOutAt: staffTimeLogs.clockOutAt,
        totalHours: staffTimeLogs.totalHours,
        drawerState: cashDrawerSessions.state,
        openingFloat: cashDrawerSessions.openingFloat,
        closingTotalDeclared: cashDrawerSessions.closingTotalDeclared,
        variance: cashDrawerSessions.variance,
      })
      .from(staffTimeLogs)
      .innerJoin(users, eq(staffTimeLogs.userId, users.id))
      .leftJoin(cashDrawerSessions, drawerJoinCondition)
      .where(and(...pageConditions))
      .orderBy(desc(staffTimeLogs.clockInAt), desc(staffTimeLogs.id))
      .limit(limit + 1),
    db
      .select({ total: count() })
      .from(staffTimeLogs)
      .innerJoin(users, eq(staffTimeLogs.userId, users.id))
      .where(and(...filterConditions)),
  ])

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.clockInAt, last.id) : null
  const totalCount = countRow?.total ?? 0
  const activeNow = data.filter((r) => !r.clockOutAt).length

  res.set('X-Total-Count', String(totalCount))
  if (nextCursor) res.set('X-Next-Cursor', nextCursor)
  res.json({
    data: data.map((r) => ({
      id: r.displayId,
      userId: r.userDisplayId,
      staffName: `${r.staffFirstName} ${r.staffLastName}`,
      role: r.role,
      clockInAt: r.clockInAt.toISOString(),
      clockOutAt: r.clockOutAt?.toISOString() ?? null,
      totalHours: r.totalHours,
      drawerSession: buildDrawerSession(r),
    })),
    activeNow,
  })
})

/** GET /api/admin/attendance/:id — single staff_time_log with user + branch + drawerSession */
adminAttendanceRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const idParsed = tlgDisplayIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid attendance log id', code: 'INVALID_ID' })
    return
  }
  const tlgDisplayId = idParsed.data

  const [row] = await db
    .select({
      id: staffTimeLogs.displayId,
      tenantId: staffTimeLogs.tenantId,
      userDisplayId: users.displayId,
      branchDisplayId: branches.displayId,
      clockInAt: staffTimeLogs.clockInAt,
      clockOutAt: staffTimeLogs.clockOutAt,
      totalHours: staffTimeLogs.totalHours,
      notes: staffTimeLogs.notes,
      createdAt: staffTimeLogs.createdAt,
      updatedAt: staffTimeLogs.updatedAt,
      createdById: staffTimeLogs.createdById,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userRole: userPrimaryRoleSql(users.id),
      userEmail: users.email,
      branchName: branches.name,
      branchCode: branches.code,
      drawerState: cashDrawerSessions.state,
      openingFloat: cashDrawerSessions.openingFloat,
      closingTotalDeclared: cashDrawerSessions.closingTotalDeclared,
      variance: cashDrawerSessions.variance,
    })
    .from(staffTimeLogs)
    .innerJoin(users, eq(staffTimeLogs.userId, users.id))
    .innerJoin(branches, eq(staffTimeLogs.branchId, branches.id))
    .leftJoin(cashDrawerSessions, drawerJoinCondition)
    .where(and(eq(staffTimeLogs.tenantId, tenantId), eq(staffTimeLogs.displayId, tlgDisplayId)))
    .limit(1)

  if (!row) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' })
    return
  }

  res.json({
    data: {
      id: row.id,
      clockInAt: row.clockInAt.toISOString(),
      clockOutAt: row.clockOutAt?.toISOString() ?? null,
      totalHours: row.totalHours,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      // createdById is internal bigint; we don't surface it here. Future:
      // join `creator` alias + project creator.display_id like admin/users.ts.
      createdById: row.createdById,
      user: {
        id: row.userDisplayId,
        firstName: row.userFirstName,
        lastName: row.userLastName,
        role: row.userRole,
        email: row.userEmail,
      },
      branch: {
        id: row.branchDisplayId,
        name: row.branchName,
        code: row.branchCode,
      },
      drawerSession: buildDrawerSession(row),
    },
  })
})
