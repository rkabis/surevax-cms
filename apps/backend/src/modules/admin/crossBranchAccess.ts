import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq, desc, gte, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { crossBranchAccessGrants, branches, patients, users } from '../../shared/db/schema.js'

// Cross-Branch PHI RFC Step 9a
//
// GET /api/admin/cross-branch-access
//
// Lists cross_branch_access_grants with joins to users/branches/patients for
// retrospective compliance review (DPA §20, HIPAA §164.312(b) quarterly audit).
//
// Design choices (reconciled from RFC §6.6 + plan):
// - Reads run inside withTenantTx (userId 0 SELECT-only sentinel, branchId
//   null = tenant-wide admin read). Under FORCE RLS a bare read has no
//   app.current_tenant_id GUC and returns zero rows (2026-06-12 review Theme B).
// - The grants table has tenant_isolation RLS (cross_branch_access_grants has
//   tenant_id) but NOT branch_isolation (no branch_id column). The surevax_app
//   role reads rows scoped to the current session's tenant via RLS.
// - Mounted with requireRole('TenantAdmin', 'BranchAdmin') in app.ts.
// - Returns bare array (no documented envelope per gotchas.md convention).
// - Added to phiAccessLog NON_PHI_PREFIXES in phiAccessLog.ts: this endpoint
//   returns metadata about access, not a patient chart. Listing grant rows
//   does not directly expose clinical PHI (no diagnoses, doses, or lab data).
//   Cross-branch CHART reads are PHI-logged through the /api/patients/:id
//   detail-endpoint pattern.

export const adminCrossbranchRouter: RouterType = Router()

const listQuerySchema = z.object({
  userId: z.string().optional(),
  patientId: z.string().optional(),
  targetBranchId: z.string().optional(),
  reasonCategory: z.string().optional(),
  since: z.string().optional(), // ISO date string
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * GET /api/admin/cross-branch-access
 *
 * Returns the 50 most-recent cross-branch access grants for this tenant,
 * with user/branch/patient denormalized columns for display.
 * Supports optional filters: userId, patientId, targetBranchId,
 * reasonCategory, since (ISO date).
 */
adminCrossbranchRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant?.id
  if (!tenantId) {
    res.status(400).json({ error: 'Tenant context required', code: 'TENANT_REQUIRED' })
    return
  }

  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR' })
    return
  }
  const q = parsed.data

  // Build conditions
  const conditions = [
    eq(crossBranchAccessGrants.tenantId, tenantId),
    isNull(crossBranchAccessGrants.deletedAt),
  ]
  if (q.since) {
    const sinceDate = new Date(q.since)
    if (!isNaN(sinceDate.getTime())) {
      conditions.push(gte(crossBranchAccessGrants.grantedAt, sinceDate))
    }
  }
  if (q.reasonCategory) {
    conditions.push(eq(crossBranchAccessGrants.reasonCategory, q.reasonCategory))
  }

  const rows = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) => {
      // Resolve optional display-id filters to bigints via a quick sub-select.
      // These are non-sensitive metadata lookups (not clinical PHI reads).
      if (q.userId) {
        const [uRow] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.displayId, q.userId)))
          .limit(1)
        // Filter by a user that doesn't exist → return empty
        if (!uRow) return []
        conditions.push(eq(crossBranchAccessGrants.userId, uRow.id))
      }

      if (q.patientId) {
        const [pRow] = await tx
          .select({ id: patients.id })
          .from(patients)
          .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, q.patientId)))
          .limit(1)
        if (!pRow) return []
        conditions.push(eq(crossBranchAccessGrants.patientId, pRow.id))
      }

      if (q.targetBranchId) {
        const [bRow] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, q.targetBranchId)))
          .limit(1)
        if (!bRow) return []
        conditions.push(eq(crossBranchAccessGrants.targetBranchId, bRow.id))
      }

      return tx
        .select({
          displayId: crossBranchAccessGrants.displayId,
          tenantId: crossBranchAccessGrants.tenantId,
          grantedAt: crossBranchAccessGrants.grantedAt,
          reasonCategory: crossBranchAccessGrants.reasonCategory,
          reasonDetail: crossBranchAccessGrants.reasonDetail,
          correlationId: crossBranchAccessGrants.correlationId,
          // user who triggered the break-glass
          userDisplayId: users.displayId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          // patient
          patientDisplayId: patients.displayId,
          patientMrn: patients.mrn,
          patientFirstName: patients.firstName,
          patientLastName: patients.lastName,
          // source + target branch (source may be null if user had no clocked-in branch)
          sourceBranchId: crossBranchAccessGrants.sourceBranchId,
          targetBranchDisplayId: branches.displayId,
          targetBranchName: branches.name,
        })
        .from(crossBranchAccessGrants)
        .innerJoin(users, eq(users.id, crossBranchAccessGrants.userId))
        .innerJoin(patients, eq(patients.id, crossBranchAccessGrants.patientId))
        .innerJoin(branches, eq(branches.id, crossBranchAccessGrants.targetBranchId))
        .where(and(...conditions))
        .orderBy(desc(crossBranchAccessGrants.grantedAt))
        .limit(q.limit)
    },
  )

  res.json(rows)
})
