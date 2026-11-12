import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { generateHealthCard } from './service.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { isCrossBranchPatient, resolvePatientBranchContext } from '../patients/db.js'

export const healthCardsRouter: RouterType = Router()

const patDisplayIdSchema = prefixedDisplayIdSchema('PAT')

/**
 * GET /api/patients/:id/health-card
 *
 * Streams a single-page PDF health card for the patient.
 *
 * Auth: requires valid access token (authMiddleware upstream).
 * Tenant: resolved from JWT / X-Tenant-Slug (tenantMiddleware upstream).
 * CSRF: GET — no X-Requested-With header required.
 * PHI: the existing phiAccessLogMiddleware matches /api/patients/:displayId and
 *      logs the patient read; health-card is a sub-path so the pattern
 *      /api/patients/PAT_xxx does NOT match — we do NOT double-log.
 *      This is intentional: the PDF download is already a distinct access event
 *      (it fetches the same patient row) and we rely on the route-level
 *      audit GUC set inside generateHealthCard via withTenantTx.
 */
healthCardsRouter.get('/:id/health-card', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user

  // authMiddleware guarantees user is present; platform admins lack tenantId
  if (!user || user.id == null || !user.tenantId) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    return
  }

  const parsed = patDisplayIdSchema.safeParse(req.params.id)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid patient ID', code: 'INVALID_ID' })
    return
  }

  const tenantId = req.tenant?.id ?? user.tenantId

  const patient = await resolvePatientBranchContext(parsed.data, tenantId)
  if (!patient) {
    res.status(404).json({ error: 'Patient not found', code: 'PATIENT_NOT_FOUND' })
    return
  }
  if (isCrossBranchPatient(patient.homeBranchId, user.branchId)) {
    res.status(403).json({
      error: 'Cross-branch chart access is read-only; health-card export is not permitted',
      code: 'CROSS_BRANCH_EXPORT_FORBIDDEN',
    })
    return
  }

  // Explicit tenant match: the patient must belong to the requesting tenant.
  // RLS enforces this at DB level; we emit an explicit 404 on miss so the
  // caller can't distinguish "wrong tenant" from "not found" (timing-safe).
  const result = await generateHealthCard({
    patientDisplayId: parsed.data,
    tenantId,
    userId: user.id,
    branchId: user.branchId,
  })

  if (!result.found) {
    res.status(404).json({ error: 'Patient not found', code: 'PATIENT_NOT_FOUND' })
    return
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
  res.setHeader('Cache-Control', 'no-store')

  result.pdfStream.pipe(res)
})
