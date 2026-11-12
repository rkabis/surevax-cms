import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../shared/db/index.js'
import { clinicalOrders, patients } from '../../shared/db/schema.js'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { validate } from '../../shared/middleware/validate.js'

/**
 * 4-column field-parity table for POST body:
 *
 * | Field  | DB col (clinical_orders) | Backend Zod            | Frontend Zod           | Frontend type |
 * |--------|--------------------------|------------------------|------------------------|---------------|
 * | reason | deferral_reason (text)   | z.string().min(5)      | z.string().min(5)      | string        |
 */

const cancelPendingBodySchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
})

const patientDisplayIdSchema = prefixedDisplayIdSchema('PAT')

type AuthUser = {
  id: number
  email: string
  role: string
  tenantId: string
  branchId: number | null
}

export const adminPatientsCancelPendingRouter: RouterType = Router()

/**
 * POST /api/admin/patients/:patientId/cancel-pending-orders
 *
 * Bulk-cancels all Scheduled/Pending clinical orders for a given patient.
 * Completed orders are intentionally excluded to avoid the BEFORE-UPDATE
 * immutability trigger.
 *
 * URL :patientId is a PAT_ display id; resolved to internal bigint at handler
 * entry (defense-in-depth: tenant filter applied to the lookup).
 *
 * Response: { cancelledCount: number, cancelledOrderIds: string[] }
 * (cancelledOrderIds are ORD_ display ids.)
 */
adminPatientsCancelPendingRouter.post(
  '/:patientId/cancel-pending-orders',
  validate(cancelPendingBodySchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id

    const patientIdParsed = patientDisplayIdSchema.safeParse(req.params['patientId'])
    if (!patientIdParsed.success) {
      res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
      return
    }
    const patientDisplayId = patientIdParsed.data

    // Resolve patient display_id → bigint within tenant.
    const [patientRow] = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, patientDisplayId)))
      .limit(1)
    if (!patientRow) {
      res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
      return
    }
    const patientInternalId = patientRow.id

    const { reason } = req.body as { reason: string }

    const cancelledOrderIds = await withTenantTx(
      { tenantId, userId: user.id, branchId: user.branchId },
      async (tx) => {
        const rows = await tx
          .update(clinicalOrders)
          .set({
            status: 'Cancelled',
            deferralReason: `BULK_CANCEL: ${reason}`,
            rowVersion: sql`${clinicalOrders.rowVersion} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(clinicalOrders.tenantId, tenantId),
              eq(clinicalOrders.patientId, patientInternalId),
              inArray(clinicalOrders.status, ['Scheduled', 'Pending']),
              sql`${clinicalOrders.deletedAt} IS NULL`,
            ),
          )
          .returning({ displayId: clinicalOrders.displayId })

        return rows.map((r) => r.displayId)
      },
    )

    res.json({
      cancelledCount: cancelledOrderIds.length,
      cancelledOrderIds,
    })
  },
)
