import { and, eq, isNull, gte, lt, asc, sql } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { staffTimeLogs, userBranches, userRoles, users } from '../../shared/db/schema.js'
import { userPrimaryRoleSql } from '../../shared/db/userViews.js'

export type BranchStaffRow = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  licenseNumber: string | null
  isActive: boolean
  canLogin: boolean
  activeShift: {
    id: string
    clockInAt: string
  } | null
}

/** Returns every active user at (tenant, branch) — except Branch accounts —
 *  with their open shift today (if any). Drives the kiosk's two columns.
 *  branchId is the internal bigint PK; callers resolve from display_id first. */
export async function listBranchStaff(
  tenantId: string,
  branchId: number,
): Promise<BranchStaffRow[]> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const rows = await withTenantTx({ tenantId, userId: 0, branchId }, async (tx) =>
    tx
      .select({
        id: users.id,
        displayId: users.displayId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: userPrimaryRoleSql(users.id),
        licenseNumber: users.licenseNumber,
        isActive: users.isActive,
        canLogin: users.canLogin,
        shiftId: staffTimeLogs.id,
        shiftDisplayId: staffTimeLogs.displayId,
        shiftClockInAt: staffTimeLogs.clockInAt,
      })
      .from(users)
      .innerJoin(
        userBranches,
        and(
          eq(userBranches.userId, users.id),
          eq(userBranches.tenantId, tenantId),
          eq(userBranches.branchId, branchId),
        ),
      )
      .leftJoin(
        staffTimeLogs,
        and(
          eq(staffTimeLogs.userId, users.id),
          eq(staffTimeLogs.tenantId, tenantId),
          isNull(staffTimeLogs.clockOutAt),
          gte(staffTimeLogs.clockInAt, todayStart),
          lt(staffTimeLogs.clockInAt, todayEnd),
        ),
      )
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.isActive, true),
          // Exclude users whose ONLY role is the 'Branch' service-account role.
          sql`NOT EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = ${users.id}
              AND ur.role = 'Branch'
          ) OR EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = ${users.id}
              AND ur.role <> 'Branch'
          )`,
        ),
      )
      .orderBy(asc(users.firstName), asc(users.lastName)),
  )

  return rows.map((r) => ({
    id: r.displayId,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    role: r.role ?? '',
    licenseNumber: r.licenseNumber,
    isActive: r.isActive,
    canLogin: r.canLogin,
    activeShift:
      r.shiftId && r.shiftDisplayId
        ? { id: r.shiftDisplayId, clockInAt: r.shiftClockInAt!.toISOString() }
        : null,
  }))
}

/** Physicians at the branch — used by the "authorized by" dropdown in
 *  physician-required forms (e.g. standing orders).
 *  branchId is the internal bigint PK; callers resolve from display_id first. */
export async function listBranchPhysicians(tenantId: string, branchId: number) {
  return withTenantTx({ tenantId, userId: 0, branchId }, async (tx) =>
    tx
      .select({
        id: users.displayId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: userPrimaryRoleSql(users.id),
        isActive: users.isActive,
        licenseNumber: users.licenseNumber,
      })
      .from(users)
      .innerJoin(
        userBranches,
        and(
          eq(userBranches.userId, users.id),
          eq(userBranches.tenantId, tenantId),
          eq(userBranches.branchId, branchId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, users.id),
          eq(userRoles.tenantId, tenantId),
          eq(userRoles.role, 'Physician'),
        ),
      )
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
      .orderBy(asc(users.lastName), asc(users.firstName)),
  )
}
