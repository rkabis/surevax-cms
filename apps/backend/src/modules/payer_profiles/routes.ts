import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  listPayerProfiles,
  getPayerProfile,
  updatePayerProfile,
  listPayerContracts,
  createPayerContract,
  updatePayerContract,
  listPayerPriceExclusions,
  addPayerPriceExclusion,
  removePayerPriceExclusion,
  PayerProfileNotFoundError,
  PriceExclusionServiceNotFoundError,
} from './db.js'
import { prefixedDisplayIdSchema, catalogCodeSchema } from '../../shared/utils/displayId.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

export const payerProfilesRouter: RouterType = Router()

const payerTypeSchema = z.enum(['HMO', 'Corporate', 'Government', 'Promo'])
const payerIdSchema = prefixedDisplayIdSchema('PYR')
const contractIdSchema = prefixedDisplayIdSchema('PCT')

/** GET /api/payer-profiles — list payer profiles (optional ?payerType) */
payerProfilesRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const raw = typeof req.query['payerType'] === 'string' ? req.query['payerType'] : undefined
  const parsed = raw ? payerTypeSchema.safeParse(raw) : null
  const payerType = parsed?.success ? parsed.data : undefined

  const data = await listPayerProfiles({ tenantId, payerType })
  res.json({ data })
})

/** GET /api/payer-profiles/:id — detail (id = PYR_ display_id) */
payerProfilesRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsedId = payerIdSchema.safeParse(req.params['id'])
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid payer profile id', code: 'INVALID_ID' })
    return
  }
  const row = await getPayerProfile({ tenantId, displayId: parsedId.data })
  if (!row) {
    res.status(404).json({ error: 'Payer profile not found', code: 'NOT_FOUND' })
    return
  }
  res.json(row)
})

/** PATCH /api/payer-profiles/:id — partial update */
const updatePayerProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Maximum 200 characters').optional(),
  payerType: z.enum(['HMO', 'Corporate', 'Government', 'Promo']).optional(),
  contactName: z.string().max(100, 'Maximum 100 characters').nullable().optional(),
  contactNumber: z.string().max(30, 'Maximum 30 characters').nullable().optional(),
  email: z.string().email('Enter a valid email address').nullable().optional(),
  address: z.string().max(500, 'Maximum 500 characters').nullable().optional(),
  paymentTermsDays: z
    .number()
    .int('Must be a whole number')
    .positive('Must be greater than 0')
    .nullable()
    .optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').nullable().optional(),
  isActive: z.boolean().optional(),
  // Blanket adjustment applied to every service's resolved price for this
  // payer, unless the service is in that payer's price-exclusion list.
  // Positive = markup, negative = discount. -100 = free; capped well short of
  // the numeric(5,2) column's ±999.99 range to keep values sane.
  priceAdjustmentPercent: z
    .number()
    .min(-100, 'Cannot discount more than 100%')
    .max(500, 'Maximum 500%')
    .nullable()
    .optional(),
  expectedRowVersion: z.number().int().nonnegative().optional(),
})

payerProfilesRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsedId = payerIdSchema.safeParse(req.params['id'])
  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid payer profile id', code: 'INVALID_ID' })
    return
  }
  const bodyParsed = updatePayerProfileSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const tenantId = req.tenant.id
  const user = (req as Request & { user: AuthUser }).user

  try {
    const updated = await updatePayerProfile({
      tenantId,
      displayId: parsedId.data,
      userId: user?.id ?? null,
      branchId: user?.branchId ?? null,
      ...bodyParsed.data,
    })
    res.json(updated)
  } catch (err) {
    if (err instanceof PayerProfileNotFoundError) {
      // Could be a genuine not-found or a row_version conflict
      if (bodyParsed.data.expectedRowVersion !== undefined) {
        res
          .status(409)
          .json({ error: 'Record was modified by another user', code: 'ROW_VERSION_CONFLICT' })
      } else {
        res.status(404).json({ error: 'Payer profile not found', code: 'NOT_FOUND' })
      }
      return
    }
    throw err
  }
})

// ---------------------------------------------------------------------------
// Payer contracts sub-resource
// ---------------------------------------------------------------------------

const createContractSchema = z.object({
  contractNumber: z
    .string()
    .min(1, 'Contract number is required')
    .max(100, 'Maximum 100 characters'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Effective from must be YYYY-MM-DD'),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Effective to must be YYYY-MM-DD')
    .nullable()
    .optional(),
  paymentTermsDays: z
    .number()
    .int('Must be a whole number')
    .positive('Must be greater than 0')
    .nullable()
    .optional(),
  claimSubmissionFormat: z.string().max(50, 'Maximum 50 characters').nullable().optional(),
  requiresPriorAuth: z.boolean().optional(),
  feeScheduleNotes: z.string().max(2000, 'Maximum 2000 characters').nullable().optional(),
  contactName: z.string().max(100, 'Maximum 100 characters').nullable().optional(),
  contactNumber: z.string().max(30, 'Maximum 30 characters').nullable().optional(),
  contactEmail: z.string().email('Enter a valid email address').nullable().optional(),
})

const updateContractSchema = createContractSchema.partial().extend({
  deletedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T/, 'Must be a valid ISO timestamp (YYYY-MM-DDThh:mm:ss)')
    .nullable()
    .optional(),
})

/** GET /api/payer-profiles/:id/contracts */
payerProfilesRouter.get('/:id/contracts', async (req: Request, res: Response) => {
  const payerIdParsed = payerIdSchema.safeParse(req.params['id'])
  if (!payerIdParsed.success) {
    res.status(400).json({ error: 'Invalid payer profile id', code: 'INVALID_ID' })
    return
  }
  const tenantId = req.tenant.id

  const data = await listPayerContracts({ tenantId, payerDisplayId: payerIdParsed.data })
  if (data === null) {
    res.status(404).json({ error: 'Payer profile not found', code: 'NOT_FOUND' })
    return
  }
  res.json({ data })
})

/** POST /api/payer-profiles/:id/contracts */
payerProfilesRouter.post('/:id/contracts', async (req: Request, res: Response) => {
  const payerIdParsed = payerIdSchema.safeParse(req.params['id'])
  if (!payerIdParsed.success) {
    res.status(400).json({ error: 'Invalid payer profile id', code: 'INVALID_ID' })
    return
  }
  const bodyParsed = createContractSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const tenantId = req.tenant.id
  const user = (req as Request & { user: AuthUser }).user

  const contract = await createPayerContract({
    tenantId,
    payerDisplayId: payerIdParsed.data,
    ...bodyParsed.data,
    createdById: user?.id ?? null,
    branchId: user?.branchId ?? null,
  })
  if (!contract) {
    res.status(404).json({ error: 'Payer profile not found', code: 'NOT_FOUND' })
    return
  }
  res.status(201).json(contract)
})

/** PUT /api/payer-profiles/:id/contracts/:contractId */
payerProfilesRouter.put('/:id/contracts/:contractId', async (req: Request, res: Response) => {
  const payerIdParsed = payerIdSchema.safeParse(req.params['id'])
  const contractIdParsed = contractIdSchema.safeParse(req.params['contractId'])
  if (!payerIdParsed.success || !contractIdParsed.success) {
    res.status(400).json({ error: 'Invalid id parameter', code: 'INVALID_ID' })
    return
  }
  const bodyParsed = updateContractSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const tenantId = req.tenant.id
  const user = (req as Request & { user: AuthUser }).user

  const updated = await updatePayerContract({
    tenantId,
    payerDisplayId: payerIdParsed.data,
    contractDisplayId: contractIdParsed.data,
    ...bodyParsed.data,
    userId: user?.id ?? null,
    branchId: user?.branchId ?? null,
  })
  if (!updated) {
    res.status(404).json({ error: 'Contract not found', code: 'NOT_FOUND' })
    return
  }
  res.json(updated)
})

// ---------------------------------------------------------------------------
// Price-adjustment exclusions — services exempt from priceAdjustmentPercent
// ---------------------------------------------------------------------------

const addPriceExclusionSchema = z.object({
  serviceId: catalogCodeSchema,
})

/** GET /api/payer-profiles/:id/price-exclusions */
payerProfilesRouter.get('/:id/price-exclusions', async (req: Request, res: Response) => {
  const payerIdParsed = payerIdSchema.safeParse(req.params['id'])
  if (!payerIdParsed.success) {
    res.status(400).json({ error: 'Invalid payer profile id', code: 'INVALID_ID' })
    return
  }
  const data = await listPayerPriceExclusions({
    tenantId: req.tenant.id,
    payerDisplayId: payerIdParsed.data,
  })
  if (data === null) {
    res.status(404).json({ error: 'Payer profile not found', code: 'NOT_FOUND' })
    return
  }
  res.json({ data })
})

/** POST /api/payer-profiles/:id/price-exclusions */
payerProfilesRouter.post('/:id/price-exclusions', async (req: Request, res: Response) => {
  const payerIdParsed = payerIdSchema.safeParse(req.params['id'])
  if (!payerIdParsed.success) {
    res.status(400).json({ error: 'Invalid payer profile id', code: 'INVALID_ID' })
    return
  }
  const bodyParsed = addPriceExclusionSchema.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation error',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const tenantId = req.tenant.id
  const user = (req as Request & { user: AuthUser }).user

  try {
    const exclusion = await addPayerPriceExclusion({
      tenantId,
      payerDisplayId: payerIdParsed.data,
      serviceId: bodyParsed.data.serviceId,
      userId: user?.id ?? null,
      branchId: user?.branchId ?? null,
    })
    if (!exclusion) {
      res.status(404).json({ error: 'Payer profile not found', code: 'NOT_FOUND' })
      return
    }
    res.status(201).json(exclusion)
  } catch (err) {
    if (err instanceof PriceExclusionServiceNotFoundError) {
      res.status(404).json({ error: 'Service not found', code: 'SERVICE_NOT_FOUND' })
      return
    }
    throw err
  }
})

/** DELETE /api/payer-profiles/:id/price-exclusions/:serviceId */
payerProfilesRouter.delete(
  '/:id/price-exclusions/:serviceId',
  async (req: Request, res: Response) => {
    const payerIdParsed = payerIdSchema.safeParse(req.params['id'])
    const serviceIdParsed = catalogCodeSchema.safeParse(req.params['serviceId'])
    if (!payerIdParsed.success || !serviceIdParsed.success) {
      res.status(400).json({ error: 'Invalid id parameter', code: 'INVALID_ID' })
      return
    }

    const tenantId = req.tenant.id
    const user = (req as Request & { user: AuthUser }).user

    const removed = await removePayerPriceExclusion({
      tenantId,
      payerDisplayId: payerIdParsed.data,
      serviceId: serviceIdParsed.data,
      userId: user?.id ?? null,
      branchId: user?.branchId ?? null,
    })
    if (removed === null) {
      res.status(404).json({ error: 'Payer profile not found', code: 'NOT_FOUND' })
      return
    }
    if (!removed) {
      res.status(404).json({ error: 'Exclusion not found', code: 'NOT_FOUND' })
      return
    }
    res.status(204).end()
  },
)
