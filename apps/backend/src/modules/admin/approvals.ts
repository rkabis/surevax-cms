import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { and, eq, desc, sql, inArray, count, ne } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  approvalRequests,
  approvalDecisions,
  branches,
  users,
  userBranches,
  userRoles,
} from '../../shared/db/schema.js'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'
import { validate } from '../../shared/middleware/validate.js'
import { displayId, prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

export const adminApprovalsRouter: RouterType = Router()

// ── ID schema (APR_ display_id surface) ───────────────────────────────────────

const aprDisplayIdSchema = prefixedDisplayIdSchema('APR')

/**
 * Cursor encoding: base64("<requested_at_iso>|<bigint id>")
 * Ordering: (requested_at DESC, id DESC) for stability.
 */
function encodeCursor(requestedAt: Date, id: number): string {
  return Buffer.from(`${requestedAt.toISOString()}|${id}`).toString('base64')
}

function decodeCursor(cursor: string): { ts: Date; id: number } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8')
    const pipe = raw.lastIndexOf('|')
    if (pipe === -1) return null
    const idNum = Number(raw.slice(pipe + 1))
    if (!Number.isInteger(idNum) || idNum <= 0) return null
    return { ts: new Date(raw.slice(0, pipe)), id: idNum }
  } catch {
    return null
  }
}

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** Resolve APR_ display_id → bigint within an existing tenant-scoped tx. Returns null if not in tenant. */
async function resolveApprovalId(
  tx: Tx,
  tenantId: string,
  aprDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.displayId, aprDisplayId)),
    )
    .limit(1)
  return row?.id ?? null
}

/**
 * GET /api/admin/approvals, list approval requests.
 *
 * Admin operational read (like audit.ts / branches.ts / users.ts): tenant-wide,
 * not per-branch, so `branchId: null`. All reads run inside `withTenantTx` -
 * a bare `db.select` returns zero rows under FORCE RLS (patterns.md "Reads
 * need the GUC too").
 */
adminApprovalsRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id

  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PARAMS', details: parsed.error.flatten() })
    return
  }

  const { cursor, limit } = parsed.data

  // Filter conditions (excluding cursor — used for total count)
  const filterConditions = [eq(approvalRequests.tenantId, tenantId)]

  // Cursor conditions (added on top of filters for the page query)
  const pageConditions = [...filterConditions]
  if (cursor) {
    const decoded = decodeCursor(cursor)
    if (decoded) {
      pageConditions.push(
        sql`(${approvalRequests.requestedAt}, ${approvalRequests.id}) < (${decoded.ts.toISOString()}::timestamptz, ${decoded.id})`,
      )
    }
  }

  const { rows, totalCount, reviewerNames } = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) => {
      const [rows, [countRow]] = await Promise.all([
        tx
          .select({
            id: approvalRequests.id,
            displayId: approvalRequests.displayId,
            requestType: approvalRequests.requestType,
            description: approvalRequests.description,
            details: approvalRequests.details,
            status: approvalRequests.status,
            entityType: approvalRequests.entityType,
            entityId: approvalRequests.entityId,
            requestedAt: approvalRequests.requestedAt,
            reviewedAt: approvalRequests.reviewedAt,
            reviewNotes: approvalRequests.reviewNotes,
            reviewedByInternalId: approvalRequests.reviewedById,
            requestedByFirstName: users.firstName,
            requestedByLastName: users.lastName,
          })
          .from(approvalRequests)
          .innerJoin(users, eq(approvalRequests.requestedById, users.id))
          .where(and(...pageConditions))
          .orderBy(desc(approvalRequests.requestedAt), desc(approvalRequests.id))
          .limit(limit + 1),
        tx
          .select({ total: count() })
          .from(approvalRequests)
          .where(and(...filterConditions)),
      ])

      // Resolve reviewer names for rows that have reviewedById set.
      const reviewerIds = rows
        .map((r) => r.reviewedByInternalId)
        .filter((id): id is number => id !== null)
      let reviewerNames: Map<number, string> = new Map()
      if (reviewerIds.length > 0) {
        const reviewers = await tx
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, reviewerIds))
        reviewerNames = new Map(reviewers.map((r) => [r.id, `${r.firstName} ${r.lastName}`]))
      }

      return { rows, totalCount: countRow?.total ?? 0, reviewerNames }
    },
  )

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.requestedAt, last.id) : null

  res.set('X-Total-Count', String(totalCount))
  if (nextCursor) res.set('X-Next-Cursor', nextCursor)
  res.json({
    data: data.map((r) => ({
      id: r.displayId,
      type: r.requestType,
      description: r.description,
      details: r.details,
      status: r.status,
      entityType: r.entityType,
      entityId: r.entityId,
      requestedBy: `${r.requestedByFirstName} ${r.requestedByLastName}`,
      requestedAt: r.requestedAt.toISOString(),
      reviewedBy: r.reviewedByInternalId
        ? (reviewerNames.get(r.reviewedByInternalId) ?? null)
        : null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    })),
  })
})

/** GET /api/admin/approvals/:id — detail with decisions audit trail */
adminApprovalsRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const idParsed = aprDisplayIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid approval request id', code: 'INVALID_ID' })
    return
  }
  const reviewer = alias(users, 'reviewer')

  const result = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) => {
      const [row] = await tx
        .select({
          id: approvalRequests.id,
          displayId: approvalRequests.displayId,
          requestType: approvalRequests.requestType,
          description: approvalRequests.description,
          details: approvalRequests.details,
          status: approvalRequests.status,
          entityType: approvalRequests.entityType,
          entityId: approvalRequests.entityId,
          requestedAt: approvalRequests.requestedAt,
          reviewedAt: approvalRequests.reviewedAt,
          reviewNotes: approvalRequests.reviewNotes,
          createdAt: approvalRequests.createdAt,
          updatedAt: approvalRequests.updatedAt,
          requestedByFirstName: users.firstName,
          requestedByLastName: users.lastName,
          requestedByEmail: users.email,
          reviewedByFirstName: reviewer.firstName,
          reviewedByLastName: reviewer.lastName,
          reviewedByEmail: reviewer.email,
          branchCode: branches.code,
          branchName: branches.name,
        })
        .from(approvalRequests)
        .innerJoin(users, eq(approvalRequests.requestedById, users.id))
        .leftJoin(reviewer, eq(approvalRequests.reviewedById, reviewer.id))
        .leftJoin(branches, eq(approvalRequests.branchId, branches.id))
        .where(
          and(
            eq(approvalRequests.tenantId, tenantId),
            eq(approvalRequests.displayId, idParsed.data),
          ),
        )

      if (!row) return null

      // Fetch full decisions audit trail
      const decisionRows = await tx
        .select({
          id: approvalDecisions.id,
          displayId: approvalDecisions.displayId,
          decision: approvalDecisions.decision,
          decidedAt: approvalDecisions.decidedAt,
          notes: approvalDecisions.notes,
          decidedById: approvalDecisions.decidedById,
          decidedByFirstName: users.firstName,
          decidedByLastName: users.lastName,
        })
        .from(approvalDecisions)
        .innerJoin(users, eq(approvalDecisions.decidedById, users.id))
        .where(eq(approvalDecisions.approvalRequestId, row.id))
        .orderBy(desc(approvalDecisions.decidedAt))

      return { row, decisionRows }
    },
  )

  if (!result) {
    res.status(404).json({ error: 'Approval request not found', code: 'NOT_FOUND' })
    return
  }
  const { row, decisionRows } = result

  res.json({
    data: {
      id: row.displayId,
      type: row.requestType,
      description: row.description,
      details: row.details,
      status: row.status,
      entityType: row.entityType,
      entityId: row.entityId,
      requestedBy:
        row.requestedByFirstName || row.requestedByLastName
          ? `${row.requestedByFirstName} ${row.requestedByLastName}`
          : null,
      requestedByEmail: row.requestedByEmail ?? null,
      requestedAt: row.requestedAt.toISOString(),
      reviewedBy:
        row.reviewedByFirstName || row.reviewedByLastName
          ? `${row.reviewedByFirstName ?? ''} ${row.reviewedByLastName ?? ''}`.trim()
          : null,
      reviewedByEmail: row.reviewedByEmail ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNotes: row.reviewNotes ?? null,
      branch:
        row.branchCode || row.branchName
          ? `${row.branchCode ?? ''}${row.branchCode && row.branchName ? ' — ' : ''}${row.branchName ?? ''}`.trim()
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      decisions: decisionRows.map((d) => ({
        id: d.displayId,
        decision: d.decision,
        decidedBy: `${d.decidedByFirstName} ${d.decidedByLastName}`,
        decidedAt: d.decidedAt.toISOString(),
        notes: d.notes ?? null,
      })),
    },
  })
})

const reviewSchema = z.object({
  notes: z.string().max(500).optional(),
})

// ── Shared decision guards ────────────────────────────────────────────────────

/**
 * Fetch the approval request row (id, requestedById, branchId, requiredApprovers,
 * approverRole, status) within an existing transaction — used by both approve and
 * reject handlers so all guards read a consistent locked snapshot.
 */
async function fetchRequestForDecision(tx: Tx, tenantId: string, internalId: number) {
  const [row] = await tx
    .select({
      id: approvalRequests.id,
      displayId: approvalRequests.displayId,
      status: approvalRequests.status,
      requestedById: approvalRequests.requestedById,
      branchId: approvalRequests.branchId,
      requiredApprovers: approvalRequests.requiredApprovers,
      approverRole: approvalRequests.approverRole,
      expiresAt: approvalRequests.expiresAt,
    })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, internalId),
        eq(approvalRequests.tenantId, tenantId),
        eq(approvalRequests.status, 'Pending'),
      ),
    )
    .for('update')
    .limit(1)
  return row ?? null
}

/**
 * Run APPR-2 / APPR-3 / APPR-4 checks on an already-fetched request row.
 * Returns a { status, body } error descriptor when a guard fails, or null when
 * all checks pass.
 *
 * Guard order:
 *   1. APPR-2 — self-approval blocked
 *   2. APPR-3 — approverRole gate
 *   3. APPR-4 — cross-branch gate (TenantAdmin is exempt)
 */
async function runApprovalGuards(
  tx: Tx,
  request: NonNullable<Awaited<ReturnType<typeof fetchRequestForDecision>>>,
  decider: AuthUser,
  tenantId: string,
): Promise<{ status: number; body: Record<string, string> } | null> {
  if (decider.id === null) {
    return { status: 401, body: { error: 'Unauthorized', code: 'UNAUTHENTICATED' } }
  }

  if (request.expiresAt !== null && request.expiresAt <= new Date()) {
    return {
      status: 410,
      body: { error: 'Approval request has expired', code: 'APPROVAL_EXPIRED' },
    }
  }

  // APPR-2: self-approval blocked
  if (decider.id === request.requestedById) {
    return {
      status: 403,
      body: { error: 'You cannot approve your own request', code: 'SELF_APPROVAL_NOT_ALLOWED' },
    }
  }

  // APPR-3: approverRole gate. TenantAdmin sits above every other clinic
  // role, so a TenantAdmin decider always clears this gate regardless of
  // which role the request names, mirroring the money-control invariant
  // (docs/ai-context/06-PRODUCT-WORKFLOWS.md:262): "manager approval" is
  // satisfied by either a BranchAdmin or a TenantAdmin. Requests that name
  // 'TenantAdmin' itself are unaffected (the exact match below already
  // passes for a TenantAdmin decider).
  const requiredRole = request.approverRole
  if (requiredRole !== null && decider.role !== 'TenantAdmin') {
    const [roleRow] = await tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.userId, decider.id), eq(userRoles.role, requiredRole)))
      .limit(1)
    if (!roleRow) {
      return {
        status: 403,
        body: {
          error: `Approver must hold the '${requiredRole}' role (or be a TenantAdmin)`,
          code: 'INSUFFICIENT_ROLE',
        },
      }
    }
  }

  // APPR-4: cross-branch gate — TenantAdmin is branch-exempt
  if (decider.role !== 'TenantAdmin') {
    const [branchRow] = await tx
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(
        and(
          eq(userBranches.userId, decider.id),
          eq(userBranches.branchId, request.branchId),
          eq(userBranches.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!branchRow) {
      return {
        status: 403,
        body: {
          error: 'You do not belong to the branch that owns this approval request',
          code: 'CROSS_BRANCH_NOT_ALLOWED',
        },
      }
    }
  }

  return null
}

/** PATCH /api/admin/approvals/:id/approve */
adminApprovalsRouter.patch(
  '/:id/approve',
  validate(reviewSchema),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    const branchId = req.tenant.branchId
    if (userId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const decider = (req as Request & { user: AuthUser }).user
    const { notes } = req.body as { notes?: string }
    const idParsed = aprDisplayIdSchema.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid approval request id', code: 'INVALID_ID' })
      return
    }
    const aprDisplayId = idParsed.data

    type ApproveResult =
      | { type: 'guard_error'; status: number; body: Record<string, string> }
      | { type: 'not_found' }
      | { type: 'duplicate' }
      | {
          type: 'ok'
          displayId: string
          status: string
          reviewedAt: string | null
          reviewNotes: string | null
        }

    const result: ApproveResult = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
      const internalId = await resolveApprovalId(tx, tenantId, aprDisplayId)
      if (internalId === null) return { type: 'not_found' }

      const request = await fetchRequestForDecision(tx, tenantId, internalId)
      if (!request) return { type: 'not_found' }

      // Run APPR-2/3/4 guards
      const guardErr = await runApprovalGuards(tx, request, decider, tenantId)
      if (guardErr) return { type: 'guard_error', ...guardErr }

      // APPR-1: prevent the same user from casting a second approving vote
      const [existingVote] = await tx
        .select({ id: approvalDecisions.id })
        .from(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.approvalRequestId, internalId),
            eq(approvalDecisions.decidedById, userId),
            ne(approvalDecisions.decision, 'Rejected'),
          ),
        )
        .limit(1)
      if (existingVote) return { type: 'duplicate' }

      // Record the decision
      await tx.insert(approvalDecisions).values({
        displayId: displayId('APD'),
        tenantId,
        approvalRequestId: internalId,
        decision: 'Approved',
        decidedById: userId,
        decidedAt: new Date(),
        notes: notes ?? null,
      })

      // APPR-1: count distinct approvers who voted 'Approved' (incl. the one just inserted)
      const [countRow] = await tx
        .select({ approvedCount: count() })
        .from(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.approvalRequestId, internalId),
            eq(approvalDecisions.decision, 'Approved'),
          ),
        )
      const approvedCount = countRow?.approvedCount ?? 0
      const quorumReached = approvedCount >= request.requiredApprovers

      if (!quorumReached) {
        // Quorum not yet reached — request stays Pending
        return {
          type: 'ok',
          displayId: request.displayId,
          status: 'Pending',
          reviewedAt: null,
          reviewNotes: null,
        }
      }

      // Quorum reached — finalize to Approved
      const now = new Date()
      const [updated] = await tx
        .update(approvalRequests)
        .set({
          status: 'Approved',
          reviewedById: userId,
          reviewedAt: now,
          reviewNotes: notes ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(approvalRequests.id, internalId),
            eq(approvalRequests.tenantId, tenantId),
            eq(approvalRequests.status, 'Pending'),
          ),
        )
        .returning()

      if (!updated) return { type: 'not_found' }

      return {
        type: 'ok',
        displayId: updated.displayId,
        status: updated.status,
        reviewedAt: updated.reviewedAt?.toISOString() ?? null,
        reviewNotes: updated.reviewNotes,
      }
    })

    if (result.type === 'guard_error') {
      res.status(result.status).json(result.body)
      return
    }
    if (result.type === 'not_found') {
      res
        .status(404)
        .json({ error: 'Approval request not found or already resolved', code: 'NOT_FOUND' })
      return
    }
    if (result.type === 'duplicate') {
      res
        .status(409)
        .json({ error: 'You have already cast an approving vote', code: 'DUPLICATE_VOTE' })
      return
    }

    res.json({
      data: {
        id: result.displayId,
        status: result.status,
        reviewedAt: result.reviewedAt,
        reviewNotes: result.reviewNotes,
      },
    })
  },
)

/** PATCH /api/admin/approvals/:id/reject */
adminApprovalsRouter.patch(
  '/:id/reject',
  validate(reviewSchema),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    const branchId = req.tenant.branchId
    if (userId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const decider = (req as Request & { user: AuthUser }).user
    const { notes } = req.body as { notes?: string }
    const idParsed = aprDisplayIdSchema.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid approval request id', code: 'INVALID_ID' })
      return
    }
    const aprDisplayId = idParsed.data

    type RejectResult =
      | { type: 'guard_error'; status: number; body: Record<string, string> }
      | { type: 'not_found' }
      | { type: 'duplicate' }
      | {
          type: 'ok'
          displayId: string
          status: string
          reviewedAt: string | null
          reviewNotes: string | null
        }

    const result: RejectResult = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
      const internalId = await resolveApprovalId(tx, tenantId, aprDisplayId)
      if (internalId === null) return { type: 'not_found' }

      const request = await fetchRequestForDecision(tx, tenantId, internalId)
      if (!request) return { type: 'not_found' }

      // Run APPR-2/3/4 guards (rejection also respects role/branch gates)
      const guardErr = await runApprovalGuards(tx, request, decider, tenantId)
      if (guardErr) return { type: 'guard_error', ...guardErr }

      const [existingDecision] = await tx
        .select({ id: approvalDecisions.id })
        .from(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.approvalRequestId, internalId),
            eq(approvalDecisions.decidedById, userId),
          ),
        )
        .limit(1)
      if (existingDecision) return { type: 'duplicate' }

      // Rejection is single-decider — immediately finalizes to Rejected
      const now = new Date()
      const [updated] = await tx
        .update(approvalRequests)
        .set({
          status: 'Rejected',
          reviewedById: userId,
          reviewedAt: now,
          reviewNotes: notes ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(approvalRequests.id, internalId),
            eq(approvalRequests.tenantId, tenantId),
            eq(approvalRequests.status, 'Pending'),
          ),
        )
        .returning()

      if (!updated) return { type: 'not_found' }

      await tx.insert(approvalDecisions).values({
        displayId: displayId('APD'),
        tenantId,
        approvalRequestId: internalId,
        decision: 'Rejected',
        decidedById: userId,
        decidedAt: now,
        notes: notes ?? null,
      })

      return {
        type: 'ok',
        displayId: updated.displayId,
        status: updated.status,
        reviewedAt: updated.reviewedAt?.toISOString() ?? null,
        reviewNotes: updated.reviewNotes,
      }
    })

    if (result.type === 'guard_error') {
      res.status(result.status).json(result.body)
      return
    }
    if (result.type === 'not_found') {
      res
        .status(404)
        .json({ error: 'Approval request not found or already resolved', code: 'NOT_FOUND' })
      return
    }
    if (result.type === 'duplicate') {
      res
        .status(409)
        .json({ error: 'You have already decided this request', code: 'DUPLICATE_VOTE' })
      return
    }

    res.json({
      data: {
        id: result.displayId,
        status: result.status,
        reviewedAt: result.reviewedAt,
        reviewNotes: result.reviewNotes,
      },
    })
  },
)
