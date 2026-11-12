import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { reviewCenterGuardianUpdateSchema, reviewCenterQuerySchema } from '@surevax/shared'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  type ReviewCenterListResponse,
  type ReviewCenterUpdateGuardianResponse,
} from './contract.js'
import { getReviewCenter, ReviewCenterUpdateError, updateGuardianFromReview } from './service.js'

export const reviewCenterRouter: ExpressRouter = Router()

function clinicDateInManila(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function requireBranchUser(req: Request, res: Response): AuthUser | null {
  const user = (req as Request & { user: AuthUser }).user
  if (user.id === null) {
    res.status(403).json({ error: 'A clinic staff account is required', code: 'FORBIDDEN' })
    return null
  }
  if (user.branchId === null) {
    res.status(403).json({ error: 'A branch assignment is required', code: 'FORBIDDEN' })
    return null
  }
  return user
}

reviewCenterRouter.get('/', async (req: Request, res: Response) => {
  const parsed = reviewCenterQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', code: 'VALIDATION_ERROR' })
    return
  }
  const user = requireBranchUser(req, res)
  if (!user || user.branchId === null || user.id === null) return

  const result = await getReviewCenter({
    tenantId: req.tenant.id,
    branchId: user.branchId,
    userId: user.id,
    date: parsed.data.date ?? clinicDateInManila(),
    q: parsed.data.q,
  })
  res.json(result satisfies ReviewCenterListResponse)
})

reviewCenterRouter.patch('/missing-guardians/:patientId', async (req: Request, res: Response) => {
  const patientId = prefixedDisplayIdSchema('PAT').safeParse(req.params['patientId'])
  const body = reviewCenterGuardianUpdateSchema.safeParse(req.body)
  if (!patientId.success || !body.success) {
    res.status(400).json({ error: 'Invalid guardian update', code: 'VALIDATION_ERROR' })
    return
  }
  const user = requireBranchUser(req, res)
  if (!user || user.branchId === null || user.id === null) return

  try {
    const result = await updateGuardianFromReview({
      tenantId: req.tenant.id,
      branchId: user.branchId,
      userId: user.id,
      patientId: patientId.data,
      reviewerDisplayId: user.displayId,
      input: body.data,
    })
    res.json(result satisfies ReviewCenterUpdateGuardianResponse)
  } catch (error) {
    if (error instanceof ReviewCenterUpdateError) {
      res.status(error.status).json({ error: error.message, code: error.code })
      return
    }
    throw error
  }
})
