import { withTenantTx } from '../../shared/db/withTenantTx.js'
import * as queries from './db.js'
import type { StaffTimeLogRow } from './db.js'

export async function getActiveShift(
  tenantId: string,
  userBigintId: number,
  reqUserId: number,
  reqBranchId: number | null,
): Promise<(StaffTimeLogRow & { drawerSession: queries.DrawerSessionSummary | null }) | null> {
  const raw = await withTenantTx(
    { tenantId, userId: reqUserId, branchId: reqBranchId },
    async (_tx) => queries.getActiveShiftRaw(tenantId, userBigintId),
  )
  if (!raw) return null

  // Fetch the surfaced (display-id projected) form alongside the drawer summary.
  const surfaced = await queries.getActiveShift(tenantId, userBigintId)
  if (!surfaced) return null

  const drawerSession = await queries.getDrawerSessionForLog(tenantId, raw.id)
  return { ...surfaced, drawerSession }
}

export async function clockIn(
  tenantId: string,
  userBigintId: number,
  branchBigintId: number,
  reqUserId: number,
  reqBranchId: number | null,
  openingFloat: string | null,
): Promise<StaffTimeLogRow> {
  return withTenantTx({ tenantId, userId: reqUserId, branchId: reqBranchId }, async (tx) => {
    const log = await queries.clockIn(
      { tenantId, userId: userBigintId, branchId: branchBigintId, createdById: reqUserId },
      tx,
    )
    if (openingFloat !== null) {
      await queries.openDrawerSession(
        {
          tenantId,
          userId: userBigintId,
          branchId: branchBigintId,
          openingFloat,
          createdById: reqUserId,
        },
        tx,
      )
    }
    return log
  })
}

export async function clockOut(
  tenantId: string,
  userBigintId: number,
  notes: string | undefined,
  reqUserId: number,
  reqBranchId: number | null,
  closingTotal: string | null,
): Promise<StaffTimeLogRow | null> {
  const active = await queries.getActiveShiftRaw(tenantId, userBigintId)
  if (!active) return null

  return withTenantTx({ tenantId, userId: reqUserId, branchId: reqBranchId }, async (tx) => {
    const log = await queries.clockOut(tenantId, active.id, notes, tx)
    if (closingTotal !== null) {
      await queries.closeDrawerSession(
        {
          tenantId,
          userId: userBigintId,
          branchId: active.branchId,
          closingTotalDeclared: closingTotal,
        },
        tx,
      )
    }
    return log
  })
}

export async function listStaffTimeLogs(
  tenantId: string,
  reqUserId: number,
  reqBranchId: number | null,
  limit?: number,
): Promise<StaffTimeLogRow[]> {
  return withTenantTx({ tenantId, userId: reqUserId, branchId: reqBranchId }, async (_tx) =>
    queries.listStaffTimeLogs(tenantId, limit),
  )
}

export async function getStaffTimeLogByDisplayId(
  tenantId: string,
  logDisplayId: string,
  reqUserId: number,
  reqBranchId: number | null,
): Promise<(StaffTimeLogRow & { drawerSession: queries.DrawerSessionSummary | null }) | null> {
  const resolved = await withTenantTx(
    { tenantId, userId: reqUserId, branchId: reqBranchId },
    async (_tx) => queries.getLogByDisplayId(tenantId, logDisplayId),
  )
  if (!resolved) return null
  const drawerSession = await queries.getDrawerSessionForLog(tenantId, resolved.bigintId)
  return { ...resolved.row, drawerSession }
}
