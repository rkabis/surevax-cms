import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { requireRole } from '../../shared/middleware/requireRole.js'
import {
  listInventoryLots,
  listInventoryMovements,
  getInventoryLot,
  getInventorySummary,
  getLotMovements,
  listActiveProducts,
  receiveStock,
  type InventoryFilter,
} from './db.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source, see docs/specs/api-contract-codegen.md.
import {
  lotIdSchema,
  receiveBody,
  productsQuerySchema,
  type InventoryListResponse,
  type InventoryMovementsResponse,
  type InventoryLotsResponse,
  type InventoryLotMovementsResponse,
  type InventoryLotDetailResponse,
  type InventoryReceiveResponse,
  type InventoryProductsResponse,
} from './contract.js'

export const inventoryRouter: RouterType = Router()

const VALID_FILTERS = new Set(['all', 'low_stock', 'quarantined', 'expiring_soon'])

// Allow-list of sortable column keys for GET /api/inventory.
const INVENTORY_SORTABLE_COLUMNS = ['expiry_date', 'quantity_on_hand', 'received_at'] as const
type InventorySortCol = (typeof INVENTORY_SORTABLE_COLUMNS)[number]

/** GET /api/inventory — list lots with optional search, filter, and sort */
inventoryRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined
  const filterParam = typeof req.query['filter'] === 'string' ? req.query['filter'] : 'all'
  const filter = VALID_FILTERS.has(filterParam) ? (filterParam as InventoryFilter) : 'all'

  const sortRaw = typeof req.query['sort'] === 'string' ? req.query['sort'] : undefined
  const sort = INVENTORY_SORTABLE_COLUMNS.includes(sortRaw as InventorySortCol)
    ? (sortRaw as InventorySortCol)
    : undefined
  const orderRaw = typeof req.query['order'] === 'string' ? req.query['order'] : undefined
  const order = orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : undefined

  const [lotsResult, summary] = await Promise.all([
    listInventoryLots({ tenantId, q, filter, sort, order }),
    getInventorySummary(tenantId),
  ])

  res.setHeader('X-Total-Count', String(lotsResult.totalCount))
  res.json(wire({ data: lotsResult.rows, summary }) satisfies InventoryListResponse)
})

/**
 * GET /api/inventory/movements — branch-day-scoped movement log for EOD reconciliation.
 * `?date=YYYY-MM-DD` (defaults to today). Branch scoped from session — never query.
 * Bare-array body; X-Day-Totals header carries `{count, byDirection: {in,out,adjust}}`.
 */
inventoryRouter.get('/movements', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const user = (req as Request & { user: AuthUser }).user
  const branchId = user?.branchId ?? null
  if (branchId === null) {
    res.status(400).json({ error: 'No branch associated with this session' })
    return
  }

  const dateRaw = typeof req.query['date'] === 'string' ? req.query['date'] : undefined
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : clinicCalendarDateString()

  const rows = await listInventoryMovements({ tenantId, branchId, date })
  const byDirection: { in: number; out: number; adjust: number } = { in: 0, out: 0, adjust: 0 }
  for (const r of rows) byDirection[r.direction] += 1
  const counts = { count: rows.length, byDirection }
  res.setHeader('X-Day-Totals', JSON.stringify(counts))
  res.json(wire(rows) satisfies InventoryMovementsResponse)
})

/**
 * GET /api/inventory/products: active products a receive-stock intake can be
 * filed against, optionally filtered by `?q=` (name or manufacturer). Backs
 * the frontend product picker; there is no standalone products module yet.
 */
inventoryRouter.get('/products', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = productsQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', code: 'INVALID_INPUT' })
    return
  }
  const rows = await listActiveProducts({ tenantId, q: parsed.data.q })
  res.json(wire(rows) satisfies InventoryProductsResponse)
})

/**
 * POST /api/inventory/receive: record a delivery of stock at the caller's
 * session branch (never from the request body). Creates a lot, or tops up an
 * existing one for a repeat delivery of the same batch, plus the paired 'In'
 * movement `maintain_lot_balances` needs to keep balances in sync.
 */
inventoryRouter.post(
  '/receive',
  requireRole('TenantAdmin', 'BranchAdmin', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    const branchId = req.tenant.branchId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    if (branchId === null) {
      res
        .status(400)
        .json({ error: 'No branch associated with this session', code: 'BRANCH_REQUIRED' })
      return
    }

    const parsed = receiveBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    try {
      const result = await receiveStock(
        { tenantId, userId, branchId },
        {
          productDisplayId: parsed.data.productId,
          batchNumber: parsed.data.batchNumber,
          expiryDate: parsed.data.expiryDate,
          quantity: parsed.data.quantity,
          unitCost: parsed.data.unitCost,
          manufacturer: parsed.data.manufacturer,
          supplierName: parsed.data.supplierName ?? null,
          supplierInvoiceNumber: parsed.data.supplierInvoiceNumber ?? null,
          notes: parsed.data.notes ?? null,
        },
      )
      res.status(201).json(wire(result) satisfies InventoryReceiveResponse)
    } catch (err) {
      // LifecycleError carries `httpStatus`, not `statusCode`: a duck-typed
      // `{ statusCode?: number }` cast (the shape used elsewhere in this
      // codebase) silently misses it and rethrows into a bare 500. Use the
      // canonical shared/lib/lifecycleError.ts translator instead.
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

/** GET /api/inventory/lots — bare-array lots list with cursor pagination + X-Total-Count header.
 *
 * Cursor is now a compound opaque string (API-3 fix): encode as "<sortVal>:<bigintId>".
 * Pass the value from the `X-Next-Cursor` response header as `?cursor=` on the next page.
 * Numeric-only cursor strings are rejected (they were the old id-only format that caused
 * skips/duplicates when sorted by expiry_date).
 */
inventoryRouter.get('/lots', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined
  const filterParam = typeof req.query['filter'] === 'string' ? req.query['filter'] : 'all'
  const filter = VALID_FILTERS.has(filterParam) ? (filterParam as InventoryFilter) : 'all'
  // API-3: cursor is now an opaque compound string "<sortVal>:<id>".
  // Accept any non-empty string; db.ts validates and ignores malformed cursors.
  const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : undefined
  const limitRaw = typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : NaN
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  const sortRaw = typeof req.query['sort'] === 'string' ? req.query['sort'] : undefined
  const sort = INVENTORY_SORTABLE_COLUMNS.includes(sortRaw as InventorySortCol)
    ? (sortRaw as InventorySortCol)
    : undefined
  const orderRaw = typeof req.query['order'] === 'string' ? req.query['order'] : undefined
  const order = orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : undefined

  const result = await listInventoryLots({
    tenantId,
    q,
    filter,
    cursor,
    limit,
    sort,
    order,
  })
  res.setHeader('X-Total-Count', String(result.totalCount))
  if (result.nextCursor != null) {
    res.setHeader('X-Next-Cursor', result.nextCursor)
  }
  res.json(wire(result.rows) satisfies InventoryLotsResponse)
})

/** GET /api/inventory/lots/:id/movements — Phase 2: movement history from inventory_movements */
inventoryRouter.get('/lots/:id/movements', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsedLotId = lotIdSchema.safeParse(req.params['id'])
  if (!parsedLotId.success) {
    res.status(400).json({ error: 'Invalid lot id', code: 'INVALID_ID' })
    return
  }
  const limitParam =
    typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined
  // API-4: clamp to prevent unbounded queries (?limit=99999999 → DoS vector)
  const MAX_MOVEMENTS_LIMIT = 200
  const limit =
    limitParam != null && !isNaN(limitParam)
      ? Math.min(Math.max(1, limitParam), MAX_MOVEMENTS_LIMIT)
      : 100

  const movements = await getLotMovements({
    tenantId,
    lotDisplayId: parsedLotId.data,
    limit,
  })
  if (movements === null) {
    res.status(404).json({ error: 'Inventory lot not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(movements) satisfies InventoryLotMovementsResponse)
})

/** GET /api/inventory/lots/:id — lot detail with joined service and Phase 2 balance fields */
inventoryRouter.get('/lots/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = lotIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid lot id', code: 'INVALID_ID' })
    return
  }
  const lot = await getInventoryLot({ tenantId, displayId: parsed.data })
  if (!lot) {
    res.status(404).json({ error: 'Inventory lot not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(lot) satisfies InventoryLotDetailResponse)
})

/** GET /api/inventory/:id — lot detail (original path, retained for backward compat) */
inventoryRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = lotIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid lot id', code: 'INVALID_ID' })
    return
  }
  const lot = await getInventoryLot({ tenantId, displayId: parsed.data })
  if (!lot) {
    res.status(404).json({ error: 'Inventory lot not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(lot) satisfies InventoryLotDetailResponse)
})
