import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { getService, getServicePrices, listServices, createService, updateService } from './db.js'
import { catalogCodeSchema } from '../../shared/utils/displayId.js'
import { requireRole } from '../../shared/middleware/requireRole.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

const createServiceSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_]+$/, 'Code must be alphanumeric with underscores'),
  sku: z.string().max(50).optional().nullable(),
  name: z.string().min(1).max(200),
  serviceType: z
    .enum(['Vaccine', 'Consultation', 'Lab', 'Procedure', 'Product'])
    .optional()
    .default('Vaccine'),
  category: z.string().max(100).optional().nullable(),
  basePrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Base price must be a decimal amount (e.g. 250.00)'),
  isVatExempt: z.boolean().optional().default(false),
  requiresStock: z.boolean().optional().default(false),
  requiresRx: z.boolean().optional().default(false),
  requiresConsent: z.boolean().optional().default(false),
  requiresVis: z.boolean().optional().default(false),
})

const updateServiceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sku: z.string().max(50).optional().nullable(),
  serviceType: z.enum(['Vaccine', 'Consultation', 'Lab', 'Procedure', 'Product']).optional(),
  category: z.string().max(100).optional().nullable(),
  isVatExempt: z.boolean().optional(),
  requiresStock: z.boolean().optional(),
  requiresRx: z.boolean().optional(),
  requiresConsent: z.boolean().optional(),
  requiresVis: z.boolean().optional(),
  isActive: z.boolean().optional(),
  basePrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Base price must be a decimal amount (e.g. 250.00)')
    .optional(),
})

export const servicesRouter: RouterType = Router()

/**
 * Catalog reads stay open to every authenticated role, and the router mounts
 * in app.ts without a gate, because the POS line-item picker, the administer
 * brand picker and the arrivals wizard all resolve services. A Nurse, Cashier
 * or the shared `Branch` login must be able to GET them.
 *
 * Catalog WRITES are tenant-wide configuration, not clinical work: creating a
 * service or moving `basePrice` (which dual-writes `service_prices`) reprices
 * every future sale at every branch. Those are admin operations and carry this
 * gate per-route.
 *
 * Do NOT widen it to `Branch`. That is a shared, day-scoped service account
 * sitting on the front desk, so an unattended kiosk would be able to rewrite
 * the tenant's price list.
 *
 * The frontend mirror is `CATALOG_WRITE_ROLES` in
 * `apps/frontend/src/lib/roles.ts`; keep the two role lists identical.
 */
const requireCatalogAdmin = requireRole('TenantAdmin', 'BranchAdmin')

function ctx(req: Request) {
  const user = (req as Request & { user: AuthUser }).user
  return {
    tenantId: req.tenant.id,
    userId: user?.id ?? null,
    branchId: user?.branchId ?? null,
  }
}

/** GET /api/services: list services (optional `?q=` name/code search) */
servicesRouter.get('/', async (req: Request, res: Response) => {
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : undefined
  const data = await listServices(ctx(req), q || undefined)
  res.json({ data })
})

/** POST /api/services: create a new service (dual-writes service_prices). Admin-only. */
servicesRouter.post('/', requireCatalogAdmin, async (req: Request, res: Response) => {
  const parsed = createServiceSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues })
    return
  }
  const result = await createService(ctx(req), parsed.data)
  const service = await getService(ctx(req), result.id)
  res.status(201).json({ data: service })
})

/** GET /api/services/:id: full service record (:id is the raw catalog code) */
servicesRouter.get('/:id', async (req: Request, res: Response) => {
  const idParsed = catalogCodeSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid service id', code: 'INVALID_ID' })
    return
  }
  const service = await getService(ctx(req), idParsed.data)
  if (!service) {
    res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' })
    return
  }
  res.json({ data: service })
})

/** GET /api/services/:id/prices: price history for a service */
servicesRouter.get('/:id/prices', async (req: Request, res: Response) => {
  const idParsed = catalogCodeSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid service id', code: 'INVALID_ID' })
    return
  }
  const prices = await getServicePrices(ctx(req), idParsed.data)
  res.json({ data: prices })
})

/**
 * Update handler shared by PATCH and PUT. Every field in `updateServiceSchema`
 * is optional, so both verbs apply a partial update; PUT is accepted only as
 * an alias for callers that reach for it. Keeping one body means a change to
 * validation or error codes cannot land on one verb and miss the other.
 */
async function handleUpdateService(req: Request, res: Response): Promise<void> {
  const idParsed = catalogCodeSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid service id', code: 'INVALID_ID' })
    return
  }
  const parsed = updateServiceSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues })
    return
  }
  const result = await updateService(ctx(req), idParsed.data, parsed.data)
  if (!result) {
    res.status(404).json({ error: 'Service not found', code: 'NOT_FOUND' })
    return
  }
  const service = await getService(ctx(req), result.id)
  res.json({ data: service })
}

/**
 * PATCH /api/services/:id: update service fields; a price change dual-writes
 * service_prices. Admin-only.
 */
servicesRouter.patch('/:id', requireCatalogAdmin, handleUpdateService)

/** PUT /api/services/:id: alias of PATCH (partial update). Admin-only. */
servicesRouter.put('/:id', requireCatalogAdmin, handleUpdateService)
