/**
 * DPA / NPC erasure workflow.
 *
 * Live execution consumes a short-lived two-TenantAdmin approval exactly
 * once. It de-identifies the primary patient identity and deletes direct
 * operational identifiers, but never represents retained statutory records,
 * attachment objects, or backup copies as deleted. Patient identifiers and
 * request bodies are never written to process logs.
 */

import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, countDistinct, eq, isNull, sql } from 'drizzle-orm'
import {
  dpaErasureExecuteSchema,
  dpaErasureRequestSchema,
  dpaPurgeImpactSchema,
  type DpaErasureRequestInput,
} from '@surevax/shared'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'
import {
  approvalDecisions,
  approvalRequests,
  dpaErasureExecutions,
  patients,
  userRoles,
  users,
} from '../../shared/db/schema.js'
import { prefixedDisplayIdSchema, displayId } from '../../shared/utils/displayId.js'
import { validate } from '../../shared/middleware/validate.js'
import { logger } from '../../shared/utils/logger.js'

type ImpactRow = { entity: string; affected_count: number }

async function getImpact(tx: Tx, patientDisplayId: string, dryRun: boolean) {
  const rows = await tx.execute<ImpactRow>(
    sql`SELECT entity, affected_count FROM purge_patient(${patientDisplayId}, ${dryRun})`,
  )
  return Array.from(rows).map((row) => ({
    entity: row.entity,
    affectedCount: Number(row.affected_count),
  }))
}

function parseRequestDetails(
  value: string | null,
): Pick<DpaErasureRequestInput, 'requestReference' | 'rollbackReference'> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (typeof parsed['requestReference'] !== 'string') return null
    if (typeof parsed['rollbackReference'] !== 'string') return null
    return {
      requestReference: parsed['requestReference'],
      rollbackReference: parsed['rollbackReference'],
    }
  } catch {
    return null
  }
}

export const adminDpaRouter: RouterType = Router()

/** POST /api/admin/dpa/purge — impact analysis only. */
adminDpaRouter.post(
  '/purge',
  validate(dpaPurgeImpactSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id
    const { patientDisplayId } = req.body as { patientDisplayId: string }

    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot run DPA analysis', code: 'FORBIDDEN' })
      return
    }

    try {
      const cascade = await withTenantTx({ tenantId, userId: user.id, branchId: null }, (tx) =>
        getImpact(tx, patientDisplayId, true),
      )
      logger.info(
        {
          tenantId,
          userId: user.id,
          totalAffected: cascade.reduce((n, x) => n + x.affectedCount, 0),
        },
        'dpa: impact analysis completed',
      )
      res.json({ patientDisplayId, dryRun: true, cascade })
    } catch (err) {
      const pgCode =
        err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : undefined
      if (pgCode === '22023') {
        res.status(404).json({ error: 'Patient not found', code: 'PATIENT_NOT_FOUND' })
        return
      }
      logger.error(
        { tenantId, userId: user.id, errorCode: pgCode ?? 'UNEXPECTED' },
        'dpa: impact analysis failed',
      )
      res.status(500).json({ error: 'Failed to run impact analysis', code: 'PURGE_FAILED' })
    }
  },
)

/** POST /api/admin/dpa/erasure-requests — open a two-approver request. */
adminDpaRouter.post(
  '/erasure-requests',
  validate(dpaErasureRequestSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot request erasure', code: 'FORBIDDEN' })
      return
    }
    const userId = user.id
    const tenantId = req.tenant.id
    const body = req.body as DpaErasureRequestInput

    try {
      const result = await withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
        const [patient] = await tx
          .select({ homeBranchId: patients.homeBranchId, deletedAt: patients.deletedAt })
          .from(patients)
          .where(
            and(eq(patients.tenantId, tenantId), eq(patients.displayId, body.patientDisplayId)),
          )
          .limit(1)
        if (!patient) return { type: 'not_found' as const }
        if (patient.deletedAt !== null) return { type: 'already_deidentified' as const }

        const maybeBranchId = patient.homeBranchId ?? user.branchId
        if (maybeBranchId === null) return { type: 'branch_required' as const }
        const branchId: number = maybeBranchId

        const impact = await getImpact(tx, body.patientDisplayId, true)
        const approvalDisplayId = displayId('APR')
        await tx.insert(approvalRequests).values({
          displayId: approvalDisplayId,
          tenantId,
          branchId,
          requestType: 'patient_erasure',
          // Keep operator references in the redacted `details` field. The
          // description is emitted into ordinary audit changes and therefore
          // must remain fixed, non-PHI text.
          description: 'DPA primary-store de-identification request',
          details: JSON.stringify({
            requestReference: body.requestReference,
            legalBasis: body.legalBasis,
            retentionDecision: body.retentionDecision,
            rollbackReference: body.rollbackReference,
            statutoryDeletionComplete: false,
          }),
          entityType: 'patients',
          entityId: body.patientDisplayId,
          requestedById: userId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          requiredApprovers: 2,
          approverRole: 'TenantAdmin',
        })
        return { type: 'ok' as const, approvalDisplayId, impact }
      })

      if (result.type === 'not_found') {
        res.status(404).json({ error: 'Patient not found', code: 'PATIENT_NOT_FOUND' })
        return
      }
      if (result.type === 'already_deidentified') {
        res
          .status(409)
          .json({ error: 'Patient is already de-identified', code: 'ALREADY_EXECUTED' })
        return
      }
      if (result.type === 'branch_required') {
        res.status(409).json({ error: 'Patient has no approval branch', code: 'BRANCH_REQUIRED' })
        return
      }

      logger.info(
        { tenantId, approvalDisplayId: result.approvalDisplayId, userId },
        'dpa: erasure approval request created',
      )
      res.status(201).json({
        approvalRequestId: result.approvalDisplayId,
        requiredApprovers: 2,
        expiresInHours: 24,
        statutoryDeletionComplete: false,
        impact: result.impact,
      })
    } catch (err) {
      const errorCode =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'UNEXPECTED'
      logger.error({ tenantId, userId, errorCode }, 'dpa: erasure request failed')
      res.status(500).json({ error: 'Failed to create erasure request', code: 'REQUEST_FAILED' })
    }
  },
)

/** POST /api/admin/dpa/erasure-requests/:approvalId/execute — one-time consume. */
adminDpaRouter.post(
  '/erasure-requests/:approvalId/execute',
  validate(dpaErasureExecuteSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot execute erasure', code: 'FORBIDDEN' })
      return
    }
    const userId = user.id
    const approvalId = prefixedDisplayIdSchema('APR').safeParse(req.params['approvalId'])
    if (!approvalId.success) {
      res.status(400).json({ error: 'Invalid approval id', code: 'INVALID_ID' })
      return
    }
    const { patientDisplayId } = req.body as { patientDisplayId: string }
    const tenantId = req.tenant.id

    try {
      const result = await withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
        // Revalidate the executor inside the consuming transaction. A JWT can
        // outlive a role assignment, so route-level RBAC alone is insufficient
        // for an irreversible operation.
        const [currentExecutor] = await tx
          .select({ id: userRoles.userId })
          .from(userRoles)
          .innerJoin(
            users,
            and(
              eq(users.id, userRoles.userId),
              eq(users.tenantId, tenantId),
              eq(users.isActive, true),
              eq(users.canLogin, true),
              eq(users.status, 'Active'),
            ),
          )
          .where(
            and(
              eq(userRoles.tenantId, tenantId),
              eq(userRoles.userId, userId),
              eq(userRoles.role, 'TenantAdmin'),
              sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > now())`,
            ),
          )
          .limit(1)
        if (!currentExecutor) return { type: 'executor_not_authorized' as const }

        const [approval] = await tx
          .select({
            id: approvalRequests.id,
            status: approvalRequests.status,
            requestType: approvalRequests.requestType,
            entityType: approvalRequests.entityType,
            entityId: approvalRequests.entityId,
            expiresAt: approvalRequests.expiresAt,
            requiredApprovers: approvalRequests.requiredApprovers,
            details: approvalRequests.details,
          })
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.tenantId, tenantId),
              eq(approvalRequests.displayId, approvalId.data),
            ),
          )
          .for('update')
          .limit(1)
        if (!approval) return { type: 'not_found' as const }
        if (approval.requestType !== 'patient_erasure' || approval.entityType !== 'patients') {
          return { type: 'wrong_purpose' as const }
        }
        if (approval.entityId !== patientDisplayId) return { type: 'scope_mismatch' as const }
        if (approval.expiresAt === null || approval.expiresAt <= new Date()) {
          return { type: 'expired' as const }
        }
        if (approval.status !== 'Approved') return { type: 'not_approved' as const }

        const [voteCount] = await tx
          .select({ count: countDistinct(approvalDecisions.decidedById) })
          .from(approvalDecisions)
          .innerJoin(
            users,
            and(
              eq(users.id, approvalDecisions.decidedById),
              eq(users.tenantId, tenantId),
              eq(users.isActive, true),
              eq(users.canLogin, true),
              eq(users.status, 'Active'),
            ),
          )
          .innerJoin(
            userRoles,
            and(
              eq(userRoles.userId, approvalDecisions.decidedById),
              eq(userRoles.tenantId, tenantId),
              eq(userRoles.role, 'TenantAdmin'),
              sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > now())`,
            ),
          )
          .where(
            and(
              eq(approvalDecisions.tenantId, tenantId),
              eq(approvalDecisions.approvalRequestId, approval.id),
              eq(approvalDecisions.decision, 'Approved'),
              isNull(approvalDecisions.deletedAt),
            ),
          )
        if ((voteCount?.count ?? 0) < approval.requiredApprovers) {
          return { type: 'not_approved' as const }
        }

        const [prior] = await tx
          .select({ displayId: dpaErasureExecutions.displayId })
          .from(dpaErasureExecutions)
          .where(eq(dpaErasureExecutions.approvalRequestId, approval.id))
          .limit(1)
        if (prior) return { type: 'replayed' as const }

        const details = parseRequestDetails(approval.details)
        if (!details) return { type: 'invalid_evidence' as const }
        const impact = await getImpact(tx, patientDisplayId, true)
        await getImpact(tx, patientDisplayId, false)

        const executionId = displayId('DER')
        const completionReport = {
          primaryStoreDeidentified: true,
          statutoryDeletionComplete: false,
          associatedAttachmentMetadataAtExecution: 0,
          retainedClasses: ['clinical', 'financial', 'audit', 'phi_access_log', 'backups'],
          remainingOwnerActions: [
            'verify backup expiry under the approved retention schedule',
            'record legal-basis review for retained clinical and financial records',
          ],
        }
        const rollbackReport = {
          reference: details.rollbackReference,
          transactionalRollbackAvailable: false,
          note: 'Execution is irreversible after commit; restoration requires separately authorized recovery and would reintroduce erased identifiers.',
        }
        await tx.insert(dpaErasureExecutions).values({
          displayId: executionId,
          tenantId,
          approvalRequestId: approval.id,
          patientDisplayId,
          executedById: userId,
          requestReference: details.requestReference,
          rollbackReference: details.rollbackReference,
          impactReport: sql`${JSON.stringify(impact)}::jsonb`,
          completionReport: sql`${JSON.stringify(completionReport)}::jsonb`,
          rollbackReport: sql`${JSON.stringify(rollbackReport)}::jsonb`,
        })
        return { type: 'ok' as const, executionId, impact, completionReport, rollbackReport }
      })

      const errors: Record<string, { status: number; code: string; error: string }> = {
        executor_not_authorized: {
          status: 403,
          code: 'FORBIDDEN',
          error: 'Current TenantAdmin role required',
        },
        not_found: { status: 404, code: 'APPROVAL_NOT_FOUND', error: 'Approval not found' },
        wrong_purpose: { status: 409, code: 'WRONG_PURPOSE', error: 'Approval is not for erasure' },
        scope_mismatch: {
          status: 403,
          code: 'SCOPE_MISMATCH',
          error: 'Approval patient scope does not match',
        },
        expired: { status: 410, code: 'APPROVAL_EXPIRED', error: 'Approval has expired' },
        not_approved: {
          status: 403,
          code: 'APPROVAL_REQUIRED',
          error: 'Two approvals are required',
        },
        replayed: { status: 409, code: 'ALREADY_EXECUTED', error: 'Approval was already consumed' },
        invalid_evidence: {
          status: 409,
          code: 'INVALID_EVIDENCE',
          error: 'Approval evidence is incomplete',
        },
      }
      if (result.type !== 'ok') {
        const mapped = errors[result.type]!
        res.status(mapped.status).json({ error: mapped.error, code: mapped.code })
        return
      }

      logger.warn(
        { tenantId, approvalDisplayId: approvalId.data, executionId: result.executionId, userId },
        'dpa: primary-store de-identification executed',
      )
      res.json({
        executionId: result.executionId,
        statutoryDeletionComplete: false,
        impact: result.impact,
        completion: result.completionReport,
        rollback: result.rollbackReport,
      })
    } catch (err) {
      const pgCode =
        err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : undefined
      if (pgCode === '55000') {
        res.status(409).json({
          error: 'Active attachment objects require verified external deletion first',
          code: 'EXTERNAL_OBJECTS_PENDING',
        })
        return
      }
      if (pgCode === '22023') {
        res.status(404).json({ error: 'Patient not found', code: 'PATIENT_NOT_FOUND' })
        return
      }
      logger.error(
        {
          tenantId,
          userId,
          approvalDisplayId: approvalId.data,
          errorCode: pgCode ?? 'UNEXPECTED',
        },
        'dpa: execution failed',
      )
      res.status(500).json({ error: 'Erasure execution failed', code: 'EXECUTION_FAILED' })
    }
  },
)
