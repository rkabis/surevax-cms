import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  listPartnerLabs,
  getPartnerLab,
  createPartnerLab,
  updatePartnerLab,
  deletePartnerLab,
} from './db.js'

export const partnerLabsRouter: RouterType = Router()

const labIdSchema = prefixedDisplayIdSchema('LAB')

const labBodySchema = z.object({
  name: z.string().min(1).max(200),
  contactName: z.string().max(200).optional(),
  contactNumber: z.string().max(50).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  apiConfig: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
})

/** GET /api/partner-labs — list partner laboratories for current tenant */
partnerLabsRouter.get('/', async (req: Request, res: Response) => {
  const data = await listPartnerLabs(req.tenant.id)
  res.json(data)
})

/** GET /api/partner-labs/:id — partner laboratory detail */
partnerLabsRouter.get('/:id', async (req: Request, res: Response) => {
  const parsed = labIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid partner laboratory id', code: 'INVALID_ID' })
    return
  }
  const lab = await getPartnerLab(parsed.data, req.tenant.id)
  if (!lab) {
    res.status(404).json({ error: 'Partner laboratory not found', code: 'NOT_FOUND' })
    return
  }
  res.json(lab)
})

/** POST /api/partner-labs — create a new partner laboratory */
partnerLabsRouter.post('/', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user

  const bodyParsed = labBodySchema.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: bodyParsed.error.issues[0]?.message ?? 'Invalid body',
      code: 'VALIDATION_ERROR',
    })
    return
  }

  const row = await createPartnerLab({
    tenantId: req.tenant.id,
    ...bodyParsed.data,
    contactName: bodyParsed.data.contactName ?? null,
    contactNumber: bodyParsed.data.contactNumber ?? null,
    email: bodyParsed.data.email ?? null,
    address: bodyParsed.data.address ?? null,
    apiConfig: bodyParsed.data.apiConfig ?? null,
    userId: user?.id ?? null,
    branchId: user?.branchId ?? null,
  })

  res.status(201).json(row)
})

/** PATCH /api/partner-labs/:id — update a partner laboratory */
partnerLabsRouter.patch('/:id', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const parsed = labIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid partner laboratory id', code: 'INVALID_ID' })
    return
  }

  const bodyParsed = labBodySchema.partial().safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: bodyParsed.error.issues[0]?.message ?? 'Invalid body',
      code: 'VALIDATION_ERROR',
    })
    return
  }

  const row = await updatePartnerLab({
    tenantId: req.tenant.id,
    labDisplayId: parsed.data,
    ...bodyParsed.data,
    userId: user?.id ?? null,
    branchId: user?.branchId ?? null,
  })

  if (!row) {
    res.status(404).json({ error: 'Partner laboratory not found', code: 'NOT_FOUND' })
    return
  }
  res.json(row)
})

/** DELETE /api/partner-labs/:id — soft-delete a partner laboratory */
partnerLabsRouter.delete('/:id', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const parsed = labIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid partner laboratory id', code: 'INVALID_ID' })
    return
  }

  const row = await deletePartnerLab({
    tenantId: req.tenant.id,
    labDisplayId: parsed.data,
    userId: user?.id ?? null,
    branchId: user?.branchId ?? null,
  })

  if (!row) {
    res.status(404).json({ error: 'Partner laboratory not found', code: 'NOT_FOUND' })
    return
  }
  res.status(204).send()
})
